# Ship and read the market

```sh
./bin/wren variants keep <sample>               # only when he asks; he keeps in the portal
./bin/wren variants ship <sample> post|site|email <draft id | page id | template@version> [--why …]
./bin/wren variants channels                    # each channel's target, rates, means
./bin/wren variants unship <ship>
./bin/wren variants live <subject>              # numbers per segment, beside his calls
./bin/wren variants collect [--ship id]         # read now (the loop runs every 6 h)
```

- When he keeps a sample and it goes out (a post, a page, an email version), `ship` it.
- Read `live` before each batch. A segment where the market disagrees with his calls is the next thing to test.
- Trust a rate only when its range is narrow. `pBest` over 0.9 is a winner in that segment.
