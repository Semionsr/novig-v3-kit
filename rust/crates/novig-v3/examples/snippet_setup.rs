use novig_v3::types::{OpenSubaccount, TransferDirection, TransferRequest};
use novig_v3::{Algorithm, Client, Credentials, Environment, PrivateKey};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let pem = std::fs::read_to_string("management.pem")?;
    let manager = Client::new(Environment::Qa, Credentials::from_pem(std::env::var("NOVIG_KEY_ID")?, &pem)?);

    // A trading key belongs to a subaccount. Make one, fund it, save the key.
    let trading_key = PrivateKey::generate(Algorithm::Ed25519);
    let sub = manager
        .open_subaccount(&OpenSubaccount {
            label: "my-bot".into(),
            public_key: trading_key.public_key().to_spki_pem(),
            algorithm: Algorithm::Ed25519,
            expires_at: None,
        })
        .await?;
    let fund = TransferRequest {
        direction: TransferDirection::Fund,
        amount: "10".parse()?,
        client_transfer_id: None,
    };
    manager.transfer(sub.key_id, &fund).await?;

    std::fs::write("trading.pem", trading_key.to_pkcs8_pem())?;
    println!("export NOVIG_TRADING_KEY_ID={}", sub.key_id);
    Ok(())
}
