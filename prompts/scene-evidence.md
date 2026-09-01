# Scene Evidence Contract

The crime scene image is CLEAN.

It contains:
- the 3D environment
- objects/landmarks
- no baked-in + markers

The agent does NOT choose arbitrary screen coordinates.

Evidence types are mapped to known scene anchors:
- token_deployment → computer_deployment
- wallet_cluster → spoon_cluster
- wallet_relationship → cupboard_funding
- sell_sequence → knife_selling
- liquidity_exit → fridge_liquidity

If all primary anchors are occupied, the scene mapper uses controlled fallback anchors.

Hard rule:

NO EVIDENCE = NO MARKER.

The frontend should render markers only from `scene.markers`.
