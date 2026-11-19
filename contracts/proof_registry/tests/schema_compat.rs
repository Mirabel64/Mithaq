//! State-schema compatibility tests for contract upgrades.
//!
//! These tests write records in the *previous* on-chain layout (fixtures) and
//! check that the current contract either reads them as documented or refuses
//! them, so a schema change can never silently reinterpret stored data.
//!
//! If a test here fails after you changed `ProofRecord`, bump
//! `PROOF_RECORD_SCHEMA_VERSION`, add a migration, and add a new fixture; do
//! not edit the existing fixtures.

use proof_registry::{
    DataKey, LegacyProofRecord, ProofRecord, ProofRegistry, ProofRegistryClient, RevocationReason,
};
use soroban_sdk::{
    symbol_short,
    testutils::Address as _,
    Address, Env, Symbol,
};

/// Registry with dummy verifier / issuer-registry addresses: the schema paths
/// under test only touch storage, so no cross-contract call is made.
fn registry(env: &Env) -> (ProofRegistryClient<'static>, Address) {
    env.mock_all_auths();
    let admin = Address::generate(env);
    let id = env.register(
        ProofRegistry,
        (admin, Address::generate(env), Address::generate(env)),
    );
    (ProofRegistryClient::new(env, &id), id)
}

/// Previous-schema fixture: the 4-field record written by v0 of the contract.
fn legacy_fixture() -> LegacyProofRecord {
    LegacyProofRecord {
        verified_at: 1_700_000_000,
        expiry: 1_700_086_400,
        threshold: Some(18),
        revoked: false,
    }
}

fn store_legacy(env: &Env, id: &Address, holder: &Address, cred: &Symbol) {
    env.as_contract(id, || {
        env.storage().persistent().set(
            &DataKey::Proof(holder.clone(), cred.clone()),
            &legacy_fixture(),
        );
    });
}

#[test]
fn schema_version_is_pinned() {
    // Changing this value means the stored layout changed: add a migration
    // and a new previous-schema fixture before updating the assertion.
    let env = Env::default();
    let (client, _) = registry(&env);
    assert_eq!(client.proof_record_schema_version(), 1);
}

#[test]
fn current_record_round_trips() {
    let env = Env::default();
    let (client, id) = registry(&env);
    let holder = Address::generate(&env);
    let cred = symbol_short!("kyc");
    let record = ProofRecord {
        verified_at: 1_700_000_000,
        expiry: 1_700_086_400,
        threshold: None,
        revoked: false,
        issuer: Some(Address::generate(&env)),
        vk_version: 2,
        reason: RevocationReason::Other,
    };
    env.as_contract(&id, || {
        env.storage()
            .persistent()
            .set(&DataKey::Proof(holder.clone(), cred.clone()), &record);
    });

    let read = client.get_record(&holder, &cred).unwrap();
    assert_eq!(read.verified_at, record.verified_at);
    assert_eq!(read.expiry, record.expiry);
    assert_eq!(read.threshold, record.threshold);
    assert_eq!(read.revoked, record.revoked);
    assert_eq!(read.issuer, record.issuer);
    assert_eq!(read.vk_version, record.vk_version);
}

#[test]
fn previous_schema_record_migrates_without_reinterpretation() {
    let env = Env::default();
    let (client, id) = registry(&env);
    let holder = Address::generate(&env);
    let cred = symbol_short!("age");
    store_legacy(&env, &id, &holder, &cred);

    client.migrate_record(&holder, &cred);

    let fixture = legacy_fixture();
    let read = client.get_record(&holder, &cred).unwrap();
    // Original fields survive unchanged.
    assert_eq!(read.verified_at, fixture.verified_at);
    assert_eq!(read.expiry, fixture.expiry);
    assert_eq!(read.threshold, fixture.threshold);
    assert_eq!(read.revoked, fixture.revoked);
    // New fields take the documented fail-closed defaults.
    assert_eq!(read.issuer, None);
    assert_eq!(read.vk_version, 0);

    // Migration is idempotent.
    client.migrate_record(&holder, &cred);
    let again = client.get_record(&holder, &cred).unwrap();
    assert_eq!(again.expiry, fixture.expiry);
    assert_eq!(again.vk_version, 0);
}

#[test]
fn unmigrated_previous_schema_record_is_rejected_not_reinterpreted() {
    // Deliberate compatibility failure: reading a previous-schema record with
    // the current type must error rather than yield a silently-defaulted
    // ProofRecord. If this starts passing, the layout changed in a way that
    // reinterprets stored data and needs a migration.
    let env = Env::default();
    let (client, id) = registry(&env);
    let holder = Address::generate(&env);
    let cred = symbol_short!("age");
    store_legacy(&env, &id, &holder, &cred);

    assert!(client.try_get_record(&holder, &cred).is_err());
}
