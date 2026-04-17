# Fragment Sizing Units

The reader and topology pipeline currently applies fragment, snake, and group
limits with `wordsCount`, not tokenizer token counts.

That difference is semantically significant. Token-based thresholds must not be
copied directly into `wordsCount`-based thresholds as if they were equivalent.
Doing so materially changes fragment boundaries, attention generations, graph
connectivity, and the final snake structure.

Any change between token-based sizing and `wordsCount`-based sizing should be
treated as a behavior change and revalidated with topology-level outputs.
