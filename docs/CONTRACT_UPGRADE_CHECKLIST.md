# Contract Upgrade Checklist

A release checklist for upgrading a deployed Soroban contract (`proof_registry`,
`issuer_registry`, `credential_verifier`, `gated_pool`). It is written so an operator who
did not author the change can run it end to end. Tick every item; stop and escalate on any
failure.

## 1. Before building

- [ ] The pull request is merged and you are on the exact commit being released
      (`git rev-parse HEAD`).
- [ ] The change is classified by the version comment in the contract source
      (`CONTRACT_VERSION` in `contracts/<name>/src/lib.rs`): MAJOR for breaking ABI changes,
      MINOR for additive changes, PATCH for fixes with no ABI change. The encoded value
      (`major * 1000000 + minor * 1000 + patch`) has been **incremented** from the deployed
      one.
- [ ] If the stored `ProofRecord` shape changed, `PROOF_RECORD_SCHEMA_VERSION` in
      `contracts/proof_registry/src/lib.rs` was incremented and a migration path exists
      (`migrate_record` / `migrate_data`).
- [ ] The ABI gate passes: `node scripts/check-contract-abi.mjs`. If it reports a removed or
      changed entrypoint, treat it as a breaking change and confirm the MAJOR bump. If it
      reports an added entrypoint, refresh the baseline with
      `node scripts/check-contract-abi.mjs --update` and commit `contracts/abi-baseline.json`.

## 2. Reproducible WASM build

- [ ] Toolchain matches the pins in [REPRODUCIBLE_BUILDS.md](REPRODUCIBLE_BUILDS.md)
      (`rust-toolchain.toml`, `Cargo.lock`, no `cargo update`).
- [ ] Build the artifacts with the CI command:
      `cargo build --release --target wasm32v1-none --locked`
      (or `make build-contracts`).
- [ ] Record `sha256sum target/wasm32v1-none/release/<name>.wasm` and compare it with the
      `wasm-hashes-<commit>` artifact uploaded by the Reproducible Build workflow. They must be
      identical.

## 3. Tests

- [ ] `make test-contracts` (or `cargo test --locked`) is green, including the upgrade and
      migration tests (`old_proof_still_verifies_after_upgrade`, `migrate_record_*`) and
      `contracts/proof_registry/tests/schema_compat.rs`.
- [ ] If a stored type changed, the previous-schema fixture in `schema_compat.rs` still
      reads (or is migrated) as documented. Do not edit a fixture to make a failure pass.

## 4. Authorization

- [ ] `upgrade(new_wasm_hash)` requires the `upgrader` role. Confirm which address holds it
      (`has_role`) and that the signer you will use is that address.
- [ ] `migrate_record` requires the `admin` role; `migrate_data` requires the root admin.
      Confirm those signers are available before starting.
- [ ] Install the new WASM on the network to obtain `new_wasm_hash`, and check it equals the
      hash recorded in section 2.

## 5. Client regeneration

- [ ] Regenerate the TypeScript clients with `npm run codegen:clients` (see
      [contract-clients.md](contract-clients.md)) and commit
      `frontend/packages/proof-registry` / `frontend/packages/issuer-registry` if changed.
- [ ] Update `docs/PROOF_REGISTRY_API.md` and run `make check-api-reference`.

## 6. Perform the upgrade and migrate

- [ ] Call `upgrade(new_wasm_hash)` as the upgrader. An `upgraded` event is emitted.
- [ ] If the schema changed, call `migrate_data()` and then `migrate_record(holder,
      credential_type)` for existing records that need it. `migrate_record` is idempotent.

## 7. Verify on the deployed network

- [ ] `make verify-deployment NETWORK=<testnet|mainnet>` passes (contract ids, versions,
      WASM hashes, VKs); see also `scripts/verify-wasm.sh` in
      [REPRODUCIBLE_BUILDS.md](REPRODUCIBLE_BUILDS.md).
- [ ] `version()` returns the new encoded version and `proof_record_schema_version()`
      returns the expected schema version.
- [ ] A pre-upgrade record is still readable (`get_record`) and `is_verified` returns the
      expected result for a known holder.
- [ ] `DEPLOYMENTS.md` (if present) is updated with the new WASM hash and version.

## Rollback

If any post-upgrade check fails, pause the registry (`pause`) and escalate before calling
`upgrade` again with the previous WASM hash. Do not run migrations on a failing release.
