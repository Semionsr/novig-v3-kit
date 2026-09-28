use novig_v3::ws::{self, OrderEvent, Selection, WsConfig, WsEvent};
use novig_v3::{Credentials, Environment};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let pem = std::fs::read_to_string("trading.pem")?;
    let creds = Credentials::from_pem(std::env::var("NOVIG_TRADING_KEY_ID")?, &pem)?;

    let (stream, mut events) = ws::connect(WsConfig::new(Environment::Qa.ws_url(), Some(creds)));
    stream.subscribe(Selection::private(&["orders"]));

    while let Some(event) = events.recv().await {
        match event {
            WsEvent::Subscribed { .. } => println!("connected, watching your orders..."),
            WsEvent::Orders { events, .. } => {
                for o in events {
                    match o {
                        OrderEvent::Open { order_id, price, qty, .. } => println!("order open: {qty} at {price}  ({order_id})"),
                        OrderEvent::Fill { order_id, price, qty, remaining, .. } => println!("order filled: {qty} at {price}, {remaining} left  ({order_id})"),
                        OrderEvent::Cancel { order_id, .. } => println!("order canceled  ({order_id})"),
                        OrderEvent::Reject { order_id } => println!("order rejected  ({order_id})"),
                    }
                }
            }
            WsEvent::Gap { subject, .. } => println!("missed a message on {subject}, fixing it"),
            _ => {}
        }
    }
    Ok(())
}
