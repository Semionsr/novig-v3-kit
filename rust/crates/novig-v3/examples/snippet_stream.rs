use novig_v3::ws::{self, Selection, WsConfig, WsEvent};
use novig_v3::{Credentials, Environment};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let pem = std::fs::read_to_string("trading.pem")?;
    let creds = Credentials::from_pem(std::env::var("NOVIG_TRADING_KEY_ID")?, &pem)?;

    let (stream, mut events) = ws::connect(WsConfig::new(Environment::Qa.ws_url(), Some(creds)));
    stream.subscribe(Selection::private(&["orders"]));

    while let Some(event) = events.recv().await {
        match event {
            WsEvent::Orders { events, .. } => println!("your orders: {events:?}"),
            WsEvent::Gap { subject, .. } => println!("missed a message, fixing it: {subject}"),
            _ => {}
        }
    }
    Ok(())
}
