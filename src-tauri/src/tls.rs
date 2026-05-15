//! Build a `reqwest::ClientBuilder` configured for the host platform.
//!
//! On Android we sidestep `rustls-platform-verifier` (it surfaces too many
//! false-positive "Revoked" errors driven by stale system OCSP / CRL state)
//! and instead validate against Mozilla's webpki root bundle with the
//! ring crypto provider. On desktop we let reqwest pick its default — which
//! uses the OS trust store, plus the desktop-only `hickory-dns` resolver
//! configured via Cargo features.
pub fn client_builder() -> reqwest::ClientBuilder {
    let b = reqwest::Client::builder();
    #[cfg(target_os = "android")]
    {
        return b.use_preconfigured_tls(android_rustls_config());
    }
    #[cfg(not(target_os = "android"))]
    {
        return b;
    }
}

#[cfg(target_os = "android")]
fn android_rustls_config() -> rustls::ClientConfig {
    use rustls::crypto::ring;

    let provider = std::sync::Arc::new(ring::default_provider());
    let mut root_store = rustls::RootCertStore::empty();
    let _ = root_store
        .add_parsable_certificates(webpki_root_certs::TLS_SERVER_ROOT_CERTS.iter().cloned());

    rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .expect("rustls protocol versions")
        .with_root_certificates(root_store)
        .with_no_client_auth()
}
