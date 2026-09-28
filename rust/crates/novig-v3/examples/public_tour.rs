//! No key needed: walks production's public v3 routes and prints the busiest book it finds.
//! `cargo run --example public_tour`

use novig_v3::book::Book;
use novig_v3::client::{CatalogFilter, Conditional, TypeList};
use novig_v3::{Client, Environment};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let client = Client::public(Environment::Production)
        .on_request(|r| eprintln!("{} {}{} -> {} ({} ms)", r.method, r.path, if r.query.is_empty() { String::new() } else { format!("?{}", r.query) }, r.status, r.millis));

    let leagues = client.public_types(TypeList::Leagues).await?;
    println!("{} leagues, e.g. {:?}", leagues.len(), &leagues[..5.min(leagues.len())]);

    let markets = client.all_public_markets(CatalogFilter { league: Some("MLB".into()), limit: Some(200), ..Default::default() }, 3).await?;
    println!("{} open MLB markets", markets.len());

    let mut best: Option<(usize, Book, String)> = None;
    for m in markets.iter().filter(|m| m.market_type == "MONEY").take(25) {
        if let Conditional::Fresh { value, .. } = client.public_book(m.market_id, None).await? {
            let book = Book::from_snapshot(&value);
            if best.as_ref().is_none_or(|b| book.order_count() > b.0) {
                best = Some((book.order_count(), book, m.description.clone()));
            }
        }
    }
    if let Some((n, book, desc)) = best {
        println!("\nBusiest moneyline book: {desc} ({n} resting orders, seq {})", book.seq);
        for o in book.outcomes() {
            let m = markets.iter().find(|m| m.outcomes.iter().any(|x| &x.outcome_id == o)).unwrap();
            let name = &m.outcomes.iter().find(|x| &x.outcome_id == o).unwrap().name;
            let q = book.quote(o);
            println!("  {name:<28} bid {:>6}  offer {:>6}  top levels {:?}",
                q.bid.map(|l| l.price.to_string()).unwrap_or("-".into()),
                q.offer.map(|l| l.price.to_string()).unwrap_or("-".into()),
                book.levels(o, 3).iter().map(|l| format!("{}x{}", l.price, l.qty)).collect::<Vec<_>>());
        }
    }
    Ok(())
}
