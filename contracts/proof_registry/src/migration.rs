//! Resumable, bounded `ProofRecord` migration and its read-only dry run.
//!
//! Records live under `DataKey::Proof(holder, credential_type)` and cannot be
//! enumerated on-chain, so the administrator supplies the (holder,
//! credential_type) list off-chain, in a fixed order, in chunks of at most
//! `MAX_MIGRATION_CHUNK`. The contract persists a cursor (how many entries of
//! that list are done) so an interrupted run resumes from the cursor: a chunk
//! is only accepted when its `start` equals the stored cursor, and a failed
//! transaction reverts atomically, leaving the cursor unchanged. Each record is
//! migrated at most once because only legacy-shaped records are rewritten.

use soroban_sdk::{contracttype, panic_with_error, symbol_short, Address, Env, Map, Symbol, Val, Vec};

use crate::{DataKey, Error, LegacyProofRecord, ProofRecord, ProofRegistry, RevocationReason};

/// Maximum entries accepted per `migrate_records` / `dry_run_migration` call.
/// Keeps the ledger footprint (one read and one write per entry) well inside
/// the per-transaction entry limits.
pub const MAX_MIGRATION_CHUNK: u32 = 20;

/// Field count of the legacy `ProofRecord` map layout.
const LEGACY_FIELDS: u32 = 4;
/// Field count of the current `ProofRecord` map layout.
const CURRENT_FIELDS: u32 = 7;

#[contracttype]
#[derive(Clone)]
pub enum MigrationKey {
    /// Number of list entries processed so far.
    Cursor,
    /// Total list length, fixed by the first chunk.
    Total,
    /// Set once the cursor reaches the total.
    Complete,
}

#[contracttype]
#[derive(Clone)]
pub struct MigrationProgress {
    pub cursor: u32,
    pub total: u32,
    pub complete: bool,
}

/// Result of a dry run. Contains only counts; no record contents are returned.
#[contracttype]
#[derive(Clone)]
pub struct MigrationReport {
    /// Records in the legacy layout that a migration would rewrite.
    pub legacy: u32,
    /// Records already in the current layout (no-op).
    pub current: u32,
    /// Keys with no stored record.
    pub missing: u32,
    /// Records whose field count matches neither layout.
    pub invalid: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct EventMigrationProgress {
    pub cursor: u32,
    pub total: u32,
    pub migrated: u32,
    pub complete: bool,
}

enum Shape {
    Missing,
    Legacy,
    Current,
    Invalid,
}

fn shape(env: &Env, key: &DataKey) -> Shape {
    match env.storage().persistent().get::<_, Map<Symbol, Val>>(key) {
        None => Shape::Missing,
        Some(m) if m.len() == LEGACY_FIELDS => Shape::Legacy,
        Some(m) if m.len() == CURRENT_FIELDS => Shape::Current,
        Some(_) => Shape::Invalid,
    }
}

pub fn progress(env: &Env) -> MigrationProgress {
    let s = env.storage().instance();
    MigrationProgress {
        cursor: s.get(&MigrationKey::Cursor).unwrap_or(0),
        total: s.get(&MigrationKey::Total).unwrap_or(0),
        complete: s.get(&MigrationKey::Complete).unwrap_or(false),
    }
}

/// Read-only: classify each listed record without writing anything.
pub fn dry_run(env: &Env, records: &Vec<(Address, Symbol)>) -> MigrationReport {
    if records.len() > MAX_MIGRATION_CHUNK {
        panic_with_error!(env, Error::BatchTooLarge);
    }
    let mut report = MigrationReport { legacy: 0, current: 0, missing: 0, invalid: 0 };
    for (holder, credential_type) in records.iter() {
        match shape(env, &DataKey::Proof(holder, credential_type)) {
            Shape::Legacy => report.legacy += 1,
            Shape::Current => report.current += 1,
            Shape::Missing => report.missing += 1,
            Shape::Invalid => report.invalid += 1,
        }
    }
    report
}

/// Migrate one chunk starting at the stored cursor. The caller has already
/// passed the admin role check.
#[allow(deprecated)]
pub fn migrate_chunk(
    env: &Env,
    start: u32,
    total: u32,
    records: &Vec<(Address, Symbol)>,
) -> MigrationProgress {
    let len = records.len();
    if len == 0 {
        panic_with_error!(env, Error::BatchEmpty);
    }
    if len > MAX_MIGRATION_CHUNK {
        panic_with_error!(env, Error::BatchTooLarge);
    }
    let mut p = progress(env);
    if p.complete {
        panic_with_error!(env, Error::MigrationAlreadyComplete);
    }
    // The first chunk fixes the list length; later chunks must agree with it.
    if p.cursor == 0 {
        p.total = total;
    }
    if start != p.cursor || total != p.total || start + len > total {
        panic_with_error!(env, Error::MigrationCursorMismatch);
    }

    let mut migrated = 0u32;
    for (holder, credential_type) in records.iter() {
        let key = DataKey::Proof(holder, credential_type);
        // Only legacy-shaped records are rewritten, so replays are no-ops and
        // already-current or unrecognised records are never touched.
        if let Shape::Legacy = shape(env, &key) {
            let legacy: LegacyProofRecord = env.storage().persistent().get(&key).unwrap();
            let record = ProofRecord {
                verified_at: legacy.verified_at,
                expiry: legacy.expiry,
                threshold: legacy.threshold,
                revoked: legacy.revoked,
                issuer: None,
                vk_version: 0,
                reason: RevocationReason::Other,
            };
            env.storage().persistent().set(&key, &record);
            ProofRegistry::bump_ttl(env, &key, record.expiry);
            migrated += 1;
        }
    }

    p.cursor = start + len;
    p.complete = p.cursor == p.total;
    let s = env.storage().instance();
    s.set(&MigrationKey::Cursor, &p.cursor);
    s.set(&MigrationKey::Total, &p.total);
    if p.complete {
        s.set(&MigrationKey::Complete, &true);
        s.set(&DataKey::LastMigrationTimestamp, &env.ledger().timestamp());
    }
    env.events().publish(
        (symbol_short!("proof_reg"), symbol_short!("migrated")),
        EventMigrationProgress {
            cursor: p.cursor,
            total: p.total,
            migrated,
            complete: p.complete,
        },
    );
    p
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ProofRegistryClient;
    use soroban_sdk::{testutils::Address as _, vec};
    use test_support::Contracts;

    fn seed_legacy(env: &Env, registry: &Address, holder: &Address) {
        env.as_contract(registry, || {
            env.storage().persistent().set(
                &DataKey::Proof(holder.clone(), symbol_short!("kyc")),
                &LegacyProofRecord { verified_at: 1, expiry: 9999, threshold: None, revoked: false },
            );
        });
    }

    #[test]
    fn migration_is_bounded_resumable_and_idempotent() {
        let env = Env::default();
        env.mock_all_auths();
        let c = Contracts::deploy(&env);
        let registry = ProofRegistryClient::new(&env, &c.registry_id);
        let h: [Address; 3] = core::array::from_fn(|_| Address::generate(&env));
        for holder in h.iter() {
            seed_legacy(&env, &c.registry_id, holder);
        }
        let kyc = symbol_short!("kyc");
        let all = vec![&env, (h[0].clone(), kyc.clone()), (h[1].clone(), kyc.clone()), (h[2].clone(), kyc.clone())];

        // Dry run reports without writing.
        let report = registry.dry_run_migration(&all);
        assert_eq!((report.legacy, report.current, report.missing, report.invalid), (3, 0, 0, 0));
        assert_eq!(registry.migration_progress().cursor, 0);

        // First chunk of two; second chunk resumes at the cursor.
        let first = vec![&env, (h[0].clone(), kyc.clone()), (h[1].clone(), kyc.clone())];
        let p = registry.migrate_records(&0, &3, &first);
        assert_eq!((p.cursor, p.complete), (2, false));
        // Replaying the same chunk, or skipping ahead, is rejected.
        assert!(registry.try_migrate_records(&0, &3, &first).is_err());
        assert!(registry.try_migrate_records(&3, &3, &first).is_err());

        let rest = vec![&env, (h[2].clone(), kyc.clone())];
        let p = registry.migrate_records(&2, &3, &rest);
        assert_eq!((p.cursor, p.total, p.complete), (3, 3, true));
        assert!(registry.try_migrate_records(&3, &3, &rest).is_err());

        // Every record was migrated exactly once and none dropped.
        for holder in h.iter() {
            let r = registry.get_record(holder, &kyc).unwrap();
            assert_eq!((r.expiry, r.vk_version, r.issuer), (9999, 0, None));
        }
        let report = registry.dry_run_migration(&all);
        assert_eq!((report.legacy, report.current), (0, 3));
    }

    #[test]
    fn oversized_chunk_is_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        let c = Contracts::deploy(&env);
        let registry = ProofRegistryClient::new(&env, &c.registry_id);
        let mut list = Vec::new(&env);
        for _ in 0..=MAX_MIGRATION_CHUNK {
            list.push_back((Address::generate(&env), symbol_short!("kyc")));
        }
        assert!(registry.try_dry_run_migration(&list).is_err());
        assert!(registry.try_migrate_records(&0, &list.len(), &list).is_err());
    }
}
