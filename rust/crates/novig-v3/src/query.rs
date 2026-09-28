//! Line 5 of the NOVIG-V3 string to sign: the canonical query.
//!
//! The spec (docs.novig.com/api/signing#the-canonical-query):
//! 1. split the raw query on `&`
//! 2. split each pair at the FIRST `=`; no `=` means an empty value
//! 3. percent-decode both parts (only `%XX`; a bare `+` stays a literal `+`)
//! 4. re-encode: keep `ALPHA DIGIT - . _ ~`, write everything else as uppercase `%XX`
//! 5. sort bytewise by encoded name, then by encoded value, keeping repeats
//! 6. join with `&`
//!
//! Everything works on bytes, so a non-UTF-8 escape still round-trips and never panics.

/// Builds the canonical query from the raw query string exactly as it goes on the wire
/// (no leading `?`). An empty input gives an empty line, which is still part of the string.
pub fn canonical_query(raw: &str) -> String {
    if raw.is_empty() {
        return String::new();
    }
    let mut pairs: Vec<(String, String)> = raw
        .split('&')
        .map(|token| {
            let (name, value) = token.split_once('=').unwrap_or((token, ""));
            (encode(&decode(name)), encode(&decode(value)))
        })
        .collect();
    // Bytewise, name first then value: `Z` (0x5A) sorts before `a` (0x61).
    pairs.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()).then(a.1.as_bytes().cmp(b.1.as_bytes())));
    pairs
        .iter()
        .map(|(n, v)| format!("{n}={v}"))
        .collect::<Vec<_>>()
        .join("&")
}

/// Decodes `%XX` escapes (either hex case) into raw bytes. A `%` that isn't followed by two
/// hex digits is kept as a literal `%`, which then re-encodes as `%25`.
pub fn decode(part: &str) -> Vec<u8> {
    let bytes = part.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                out.push(h << 4 | l);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    out
}

/// Percent-encodes every byte outside RFC 3986 unreserved, with uppercase hex.
pub fn encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut out = String::with_capacity(bytes.len() * 3);
    for &b in bytes {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~') {
            out.push(b as char);
        } else {
            out.push('%');
            out.push(HEX[(b >> 4) as usize] as char);
            out.push(HEX[(b & 0x0F) as usize] as char);
        }
    }
    out
}

fn hex_val(c: u8) -> Option<u8> {
    match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn documented_cases() {
        assert_eq!(canonical_query(""), "");
        assert_eq!(canonical_query("apple=1&Zebra=2"), "Zebra=2&apple=1");
        assert_eq!(canonical_query("q=New%20York"), "q=New%20York");
        assert_eq!(canonical_query("q=foo+bar"), "q=foo%2Bbar");
        assert_eq!(canonical_query("q=foo%2Bbar"), "q=foo%2Bbar");
        assert_eq!(canonical_query("path=%2ftmp%2ffile"), "path=%2Ftmp%2Ffile");
        assert_eq!(canonical_query("lang=%C3%BC"), "lang=%C3%BC");
        assert_eq!(canonical_query("token=abc="), "token=abc%3D");
        assert_eq!(canonical_query("flag"), "flag=");
        assert_eq!(canonical_query("status=open&status=closed"), "status=closed&status=open");
        assert_eq!(canonical_query("path=%7Ehome&tag=a~b"), "path=~home&tag=a~b");
    }

    #[test]
    fn raw_unicode_and_broken_escapes() {
        // A client that forgot to encode still gets the same canonical form as one that did.
        assert_eq!(canonical_query("lang=ü"), "lang=%C3%BC");
        assert_eq!(canonical_query("a=100%"), "a=100%25");
        assert_eq!(canonical_query("a=%zz"), "a=%25zz");
        assert_eq!(canonical_query("a=%4"), "a=%254");
    }
}
