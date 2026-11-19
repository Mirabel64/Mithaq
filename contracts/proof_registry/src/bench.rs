//! Proof-submission resource benchmark (see docs/PROOF_SUBMISSION_BENCHMARKS.md).
//!
//! Run: `cargo test -p proof_registry bench -- --nocapture` and paste the
//! printed table into the doc. Inputs are the checked-in `test_support`
//! fixtures, so runs are repeatable. Set `BENCH_MAX_CPU` / `BENCH_MAX_MEM` to
//! make the run fail when any row exceeds a release-review threshold.
extern crate std;

use super::*;
use soroban_sdk::{testutils::Address as _, vec, Address, Env};
use std::{println, string::String};
use test_support::{public_inputs_to_u32, Contracts, AGE, AGGREGATE, FUNDS, KYC};

/// Soroban per-transaction ledger-entry write limit.
const TX_WRITE_ENTRIES_LIMIT: u64 = 50;

struct Cost {
    cpu: u64,
    mem: u64,
    reads: u64,
    writes: u64,
}

fn measure(env: &Env, f: impl FnOnce()) -> Cost {
    env.cost_estimate().budget().reset_unlimited();
    f();
    let r = env.cost_estimate().resources();
    Cost {
        cpu: env.cost_estimate().budget().cpu_instruction_cost(),
        mem: env.cost_estimate().budget().memory_bytes_cost(),
        reads: r.read_entries as u64,
        writes: r.write_entries as u64,
    }
}

fn sub(env: &Env, ct: &str, c: &test_support::Circuit, issuer: &Address) -> ProofSubmission {
    ProofSubmission {
        credential_type: Symbol::new(env, ct),
        proof: c.proof_bytes(env),
        public_inputs: public_inputs_to_u32(env, c.public_inputs),
        issuer_id: issuer.clone(),
        expiry: 9999,
        vk_version: None,
    }
}

fn row(label: &str, n: u64, c: &Cost) -> Cost {
    println!("| {label} | {n} | {} | {} | {} | {} |", c.cpu, c.mem, c.reads, c.writes);
    Cost { cpu: c.cpu, mem: c.mem, reads: c.reads, writes: c.writes }
}

#[test]
fn bench_proof_submission_costs() {
    println!("| path | records | cpu_instructions | memory_bytes | read_entries | write_entries |");
    println!("|---|---|---|---|---|---|");
    let mut rows: std::vec::Vec<Cost> = std::vec::Vec::new();

    // Single submission.
    {
        let env = Env::default();
        env.mock_all_auths();
        let c = Contracts::deploy(&env);
        let issuer = c.enable(&env, &KYC);
        let r = ProofRegistryClient::new(&env, &c.registry_id);
        let holder = Address::generate(&env);
        let cost = measure(&env, || {
            r.submit_proof(&holder, &issuer, &symbol_short!("kyc"), &KYC.proof_bytes(&env), &KYC.public_inputs_bytes(&env), &None, &9999);
        });
        rows.push(row("submit_proof", 1, &cost));
    }

    // Batch submission at 1..=3 distinct credential types (one per fixture
    // circuit; duplicate types in a batch are rejected by the contract).
    for n in 1..=3u32 {
        let env = Env::default();
        env.mock_all_auths();
        let c = Contracts::deploy(&env);
        let (ki, fi, ai) = (c.enable(&env, &KYC), c.enable(&env, &FUNDS), c.enable(&env, &AGE));
        let r = ProofRegistryClient::new(&env, &c.registry_id);
        let holder = Address::generate(&env);
        let mut subs = vec![&env, sub(&env, "kyc", &KYC, &ki)];
        if n >= 2 {
            subs.push_back(sub(&env, "funds", &FUNDS, &fi));
        }
        if n >= 3 {
            subs.push_back(sub(&env, "age", &AGE, &ai));
        }
        let cost = measure(&env, || r.submit_proofs(&holder, &subs));
        rows.push(row("submit_proofs", n as u64, &cost));
    }

    // Aggregate submission (N=2: KYC + age).
    {
        let env = Env::default();
        env.mock_all_auths();
        let c = Contracts::deploy(&env);
        let issuer = c.register_issuer_for(&env, &KYC, &["kyc", "age"]);
        c.set_vk(&env, &AGGREGATE, 1);
        let r = ProofRegistryClient::new(&env, &c.registry_id);
        let holder = Address::generate(&env);
        let cost = measure(&env, || {
            r.submit_aggregate_proof(
                &holder,
                &vec![&env, issuer.clone(), issuer.clone()],
                &vec![&env, symbol_short!("kyc"), symbol_short!("age")],
                &AGGREGATE.proof_bytes(&env),
                &AGGREGATE.public_inputs_bytes(&env),
                &vec![&env, 9999u64, 9999u64],
            );
        });
        rows.push(row("submit_aggregate_proof", 2, &cost));
    }

    // Optional release-review thresholds.
    let limit = |name: &str| std::env::var(name).ok().and_then(|v| v.parse::<u64>().ok());
    for c in &rows {
        if let Some(m) = limit("BENCH_MAX_CPU") {
            assert!(c.cpu <= m, "cpu {} exceeds BENCH_MAX_CPU {m}", c.cpu);
        }
        if let Some(m) = limit("BENCH_MAX_MEM") {
            assert!(c.mem <= m, "memory {} exceeds BENCH_MAX_MEM {m}", c.mem);
        }
        assert!(c.writes <= TX_WRITE_ENTRIES_LIMIT);
    }

    // #92: writes grow linearly with batch size, so the largest allowed batch
    // (one record per submission) must still fit the write-entry limit.
    let per_record = rows[3].writes.saturating_sub(rows[1].writes) / 2;
    let at_max = rows[1].writes + per_record * (MAX_BATCH_SIZE as u64 - 1);
    let label: String = std::format!("projected writes at MAX_BATCH_SIZE={MAX_BATCH_SIZE}: {at_max}");
    println!("{label}");
    assert!(at_max <= TX_WRITE_ENTRIES_LIMIT);
}
