# Spreads & links — schema

Two files. `spreads.json` defines continuants with an extended footprint (technologies,
movements, religions, eras). `links.json` defines WEIGHTED many-to-many relationships
between any two items. Together they drive the Connections view: click anything, and
everything related lights up in proportion to link strength while the rest dims.

This is the founder's 2021 Notion schema formalised: "pád SSSR se vztahuje k Rusku a
komunismu — v tomto případě vysoká důležitost u obou okruhů."

## Item ids — the join keys

    event:<exact title>     an entry in EVENTS with shape moment/episode/era
    entity:<exact title>    an entry with shape life
    polity:<id>             an id from data/polities-*.json
    spread:<id>             an id from spreads.json
    belief:<id>             a stream id from data/beliefs.json

`<exact title>` must match the EVENTS title byte-for-byte, accents and em dashes included.
It is the same join key the classifier and geocoder already use successfully.

## spreads.json

    {"spreads":[{
      "id":"printing",
      "name":"Printing technology",
      "kind":"technology",          // technology | movement | religion | era | economy
      "start":1439, "end":2026,
      "sharpness":0.25,             // 0 = pure gradient, 1 = hard legal border
      "weight":[[1439,0.2],[1500,3],[1800,8]],   // reach over time, 0-10, drives ribbon thickness
      "footprint":[                 // low-fi diffusion: where it actually is, over time
        {"year":1439,"lat":50.00,"lon":8.27,"radius":60,"intensity":0.2},
        {"year":1500,"lat":48.50,"lon":9.50,"radius":900,"intensity":0.6}
      ],
      "from":[], "to":[],           // lineage, same convention as polities
      "note":"one short clause"
    }]}

`radius` is in km. `intensity` 0-1. Two or more footprint samples; the renderer interpolates.

## links.json

    {"links":[
      {"a":"event:Gutenberg's printing press","b":"spread:printing","w":1.0,"kind":"origin"},
      {"a":"event:Luther's 95 theses — Reformation","b":"spread:printing","w":0.6,"kind":"enabled-by"}
    ]}

`w` is 0-1 relatedness strength; it is what grades the dimming, so spend the range —
1.0 means "this IS the thing", 0.3 means "worth surfacing but peripheral".

`kind`: origin | part-of | enabled-by | caused | about | opposed-to | lineage

Links are UNDIRECTED for highlighting; `a`/`b` order only reads naturally for `kind`.
An item may link to any number of others: "event:Crucifixion of Jesus" belongs to BOTH
christianity and judaism, at different strengths. That is the point of the mechanic.
