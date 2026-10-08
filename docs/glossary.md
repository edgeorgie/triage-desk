# Glossary

| Term | Definition |
|---|---|
| Agent loop | Repeat: ask the model, run the tools it requests, feed back results, until it submits. |
| Tool use | The model returns structured calls to named functions instead of free text. |
| Terminal tool | submit_triage: the call that ends the loop and carries the structured ruling. |
| Ruling | The validated decision: kind, priority, labels, duplicate, missing information, reply, confidence. |
| Duplicate detection | Ranking similar open issues by token overlap computed locally. |
| Step budget | The loop stops after 8 steps if no ruling is submitted. |
