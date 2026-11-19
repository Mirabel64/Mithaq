# ADR-005: Versioned aggregate-proof public-input layout

**Status:** Accepted design; V2 is not implemented or enabled.

## Context

The deployed aggregate circuit is a fixed KYC-then-age proof. Its 133 public
fields do not contain a layout version or credential-type tags, while
`submit_aggregate_proof` accepts credential types in a separate caller-supplied
array. Treating that array as an implicit description of the proof permits
ordering mismatches and makes extending the layout ambiguous.

## Decision

Keep the existing circuit, `"aggregate"` verifying-key name, and entry point as
**V1**. V1 is exactly 133 fields: KYC (65), age (67), and the final
`num_credentials = 2` field. The registry accepts only credential types
`[kyc, age]`, with the issuer and expiry arrays in the same order. It also
requires the exact V1 input byte length before reading fields. Existing clients
that already use that order and layout need no migration.

Future generalized aggregates use **V2** and a distinct circuit/VK identity
(`"aggregate_v2"`) and entry point (`submit_aggregate_proof_v2`). V2 does not
reinterpret V1 bytes or change the legacy method's ABI.

### V2 field encoding

All entries are 32-byte big-endian fields, as for the existing Noir public
inputs. V2 has a fixed 382-field encoding:

| Field(s) | Meaning |
|----------|---------|
| 0 | `layout_version = 2` |
| 1 | `credential_count`, 2 through 5 |
| 2–381 | Five fixed-width 76-field slots |

Each slot is:

| Relative field(s) | Meaning |
|-------------------|---------|
| 0 | `credential_type_tag` |
| 1 | `payload_field_count` |
| 2–75 | Payload of up to 74 fields, followed by zero padding |

Tags are stable protocol identifiers: `1=kyc`, `2=age`, `3=income`,
`4=funds`, `5=accreditation`, `6=employment`, `7=jurisdiction`. Each payload
uses the corresponding standalone circuit's public-input order, without any
implicit offsets: KYC 65 fields; age 67; income, funds, accreditation and
employment 66; jurisdiction 74. `payload_field_count` must equal the exact
count for the tag; every remaining payload field must be zero. V2 has five
slots even when fewer credentials are active. Slots at indices `credential_count`
through 4 must be entirely zero.

The V2 circuit constrains the version, count, tags, exact payload sizes, zero
padding, and credential-specific proof relations. Active tags must be known and
unique. The contract checks that each tag maps to the `credential_types` entry
at the same slot, then extracts that slot's issuer key and policy threshold
using the tag-defined payload schema. Thus neither a caller-supplied order nor
an inferred payload boundary can silently change a claim's meaning.
The issuer, credential-type, and expiry arrays must each have exactly
`credential_count` entries and follow the active slot order.

This design covers combinations of the seven issuer-signed credential types
listed above. Other proof families (for example membership proofs with different
public data) need an explicit tag and payload definition before inclusion.

## Rollout and compatibility

V2 must not be accepted until its Noir circuit, deterministic VK, checked-in
proof fixtures, public-input parser tests, and generated client/witness support
are available together. Register its VK under `"aggregate_v2"` and route only
the new entry point to it. Before rollout, benchmark N=2 through N=5 proving
time in single- and multi-threaded browser WASM; retain the repository's
documented 30-second mid-range-device budget. V1 clients continue to call
`submit_aggregate_proof` unchanged; V2 clients opt in by producing the
382-field tagged layout and calling `submit_aggregate_proof_v2`. Do not
dispatch V1/V2 based on a guessed field offset or accept V2 through the V1
verifier key.

## Consequences

- V1 ordering errors are rejected rather than being recorded as the wrong
  credential claim.
- Fixed-width tagged slots make offsets independent of the combination and
  order of credential types.
- The fixed V2 width is larger than a packed variable-width encoding, but
  simplifies parsing and keeps contract and circuit schemas deterministic.
- The V2 support matrix is intentionally limited to credential circuits whose
  public-input layouts are specified here; adding a type requires an explicit
  tag, exact payload length, circuit constraints, and contract extraction rule.
