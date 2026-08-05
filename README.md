# T3 Code lifecycle events plugin

This sample is based on upstream issue #5020's Pi-style extension proposal.
It demonstrates the smallest safe extension: observe-only lifecycle events,
sequence ordering, namespaced settings, a command contribution, and a
host-rendered status panel. It does not load arbitrary client code or mutate
T3 orchestration events.
