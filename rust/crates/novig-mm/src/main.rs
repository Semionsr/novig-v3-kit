//! `mm-bot`: run the reference maker from a terminal.
//!
//!   mm-bot --mock                         paper-trade the local mock exchange (no key, no network)
//!   mm-bot --market <id> [--mode paper]   paper-trade a real QA/production market
//!   mm-bot --market <id> --mode live      trade it (needs NOVIG_KEY_ID + NOVIG_PEM, env from NOVIG_ENV)

use anyhow::{Context, bail};
use novig_mm::{Bot, BotConfig, Mode, execute};
use novig_v3::mock::{self, MockConfig};
use novig_v3::types::{Chargeability, MarketFee};
use novig_v3::ws::{self, Selection, WsConfig};
use novig_v3::{Client, Credentials, Environment};
use std::sync::Arc;
use uuid::Uuid;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt().with_env_filter(std::env::var("RUST_LOG").unwrap_or_else(|_| "info".into())).init();
    let args: Vec<String> = std::env::args().collect();
    let flag = |name: &str| args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned();
    let use_mock = args.iter().any(|a| a == "--mock");
    let mode = match flag("--mode").as_deref() {
        Some("live") => Mode::Live,
        _ => Mode::Paper,
    };

    let (ws_url, creds, cfg, client) = if use_mock {
        let ex = mock::serve("127.0.0.1:0", MockConfig::default()).await?;
        let m = ex.market;
        let fee = MarketFee { coefficient: "0.03".parse()?, maker_credit: "0.5".parse()?, charged: Chargeability::WhenLive };
        let cfg = BotConfig::new(m.market_id, [m.home, m.away], ["HOME".into(), "AWAY".into()], fee, Mode::Paper);
        let url = ex.url();
        std::mem::forget(ex); // keep the mock alive for the life of the process
        (url, None, cfg, None)
    } else {
        let env = Environment::from_name(&std::env::var("NOVIG_ENV").unwrap_or_else(|_| "qa".into()));
        let market_id: Uuid = flag("--market").context("--market <uuid> is required without --mock")?.parse()?;
        let creds = match (std::env::var("NOVIG_KEY_ID"), std::env::var("NOVIG_PEM")) {
            (Ok(id), Ok(pem)) => Some(Credentials::from_pem(id, &std::fs::read_to_string(pem)?)?),
            _ => None,
        };
        if creds.is_none() {
            bail!("the websocket needs a trading key: set NOVIG_KEY_ID and NOVIG_PEM (paper mode still reads a real book)");
        }
        let client = Client::new(env.clone(), creds.clone().unwrap());
        let market = client.market(market_id).await?;
        if market.outcomes.len() != 2 {
            bail!("this reference bot handles two-outcome markets; {} has {}", market.description, market.outcomes.len());
        }
        let o = [market.outcomes[0].outcome_id, market.outcomes[1].outcome_id];
        let names = [market.outcomes[0].name.clone(), market.outcomes[1].name.clone()];
        (env.ws_url(), creds, BotConfig::new(market_id, o, names, market.fee.clone(), mode), Some(client))
    };
    run(ws_url, creds, cfg, client).await
}

async fn run(ws_url: String, creds: Option<Credentials>, cfg: BotConfig, client: Option<Client>) -> anyhow::Result<()> {
    let market = cfg.market_id;
    let live = cfg.mode == Mode::Live;
    let bot = Arc::new(tokio::sync::Mutex::new(Bot::new(cfg)));
    let (handle, mut rx) = ws::connect(WsConfig::new(ws_url, creds));
    handle.subscribe(Selection::market(market, "book"));
    if live {
        handle.subscribe(Selection::private(&["orders", "positions"]));
    }
    bot.lock().await.start();
    let mut report = tokio::time::interval(std::time::Duration::from_secs(5));
    loop {
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {
                let actions = bot.lock().await.stop();
                if let Some(c) = &client { for a in actions { execute(c, &bot, a).await; } }
                break;
            }
            _ = report.tick() => {
                let book = handle.book(&market);
                let s = bot.lock().await.state(book.as_ref());
                println!("[{}] fair {:?}  quotes {}  fills {}  pnl ${}  credits ${}", s.status, s.fair, s.quotes.iter().map(|q| format!("{}@{}", q.name, q.price)).collect::<Vec<_>>().join(" "), s.counters.fills, s.pnl.total, s.pnl.maker_credits);
            }
            ev = rx.recv() => {
                let Some(ev) = ev else { break };
                let book = handle.book(&market);
                let actions = bot.lock().await.on_event(&ev, book.as_ref(), novig_v3::sign::now_millis());
                if let Some(c) = &client { for a in actions { execute(c, &bot, a).await; } }
            }
        }
    }
    Ok(())
}
