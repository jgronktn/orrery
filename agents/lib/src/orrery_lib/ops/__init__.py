"""Operations (OPS) domain tools. One module per domain, each exposing
`register(agent)`; the OPS agent calls each one's register. Shipping is the
first; inventory, purchasing, … are added as sibling modules.
"""
