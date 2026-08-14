use std::{env, fs};

use base64::{Engine, engine::general_purpose::STANDARD};
use minisign_verify::{PublicKey, Signature};

#[test]
#[ignore = "requires release signing secrets and is run by pnpm check:updater-key"]
fn configured_public_key_verifies_the_release_signing_key() {
    for name in [
        "TAURI_SIGNING_PRIVATE_KEY",
        "TAURI_SIGNING_PRIVATE_KEY_PATH",
        "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
    ] {
        assert!(
            env::var_os(name).is_none(),
            "{name} must not be exposed to Cargo tests"
        );
    }
    let payload_path = env::var("DSH_UPDATER_TEST_PAYLOAD")
        .expect("DSH_UPDATER_TEST_PAYLOAD is required for the release key gate");
    let signature_path = env::var("DSH_UPDATER_TEST_SIGNATURE")
        .expect("DSH_UPDATER_TEST_SIGNATURE must accompany the updater test payload");

    let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json"))
        .expect("tauri.conf.json must be valid JSON");
    let encoded_public_key = config
        .pointer("/plugins/updater/pubkey")
        .and_then(serde_json::Value::as_str)
        .expect("updater public key must be configured");
    let public_key_text = STANDARD
        .decode(encoded_public_key)
        .expect("updater public key must use valid base64");
    let public_key = PublicKey::decode(
        std::str::from_utf8(&public_key_text).expect("decoded updater public key must be UTF-8"),
    )
    .expect("decoded updater public key must be valid minisign data");
    let encoded_signature = fs::read_to_string(signature_path).expect("signature must be readable");
    let signature_text = STANDARD
        .decode(encoded_signature.trim())
        .expect("updater signature must use valid base64");
    let signature = Signature::decode(
        std::str::from_utf8(&signature_text).expect("decoded updater signature must be UTF-8"),
    )
    .expect("signature must be valid minisign data");
    let payload = fs::read(payload_path).expect("signed updater test payload must be readable");

    public_key
        .verify(&payload, &signature, false)
        .expect("release private key does not match the updater public key");

    let mut tampered_payload = payload;
    tampered_payload[0] ^= 1;
    assert!(
        public_key
            .verify(&tampered_payload, &signature, false)
            .is_err(),
        "the updater must reject a modified package"
    );
}
