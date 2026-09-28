use novig_v3::client::CatalogFilter;
use novig_v3::types::{MarketStatus, PlaceOrder, TimeInForce};
use novig_v3::{Client, Credentials, Environment};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let pem = std::fs::read_to_string("trading.pem")?;
    let creds = Credentials::from_pem(std::env::var("NOVIG_TRADING_KEY_ID")?, &pem)?;
    let client = Client::new(Environment::Qa, creds);

    let markets = client.markets(&CatalogFilter { limit: Some(20), ..Default::default() }).await?;
    let market = markets.items.iter().find(|m| m.status == MarketStatus::Open).unwrap();
    println!("market: {}", market.description);

    let order = client
        .place_order(&PlaceOrder {
            outcome_id: market.outcomes[0].outcome_id,
            price: "0.010".parse()?,
            qty: 100,
            tif: TimeInForce::PO,
            ttl: None,
            client_id: None,
        })
        .await?;
    println!("placed: {}", order.order_id);

    client.cancel_order(order.order_id).await?;
    println!("canceled");
    Ok(())
}
