---
status: proposed
---

# Track upstream with explicit portability patches

OpenCloudOS will preserve Cloudflare OS history and keep downstream changes as an identifiable portability patch set instead of performing a clean-room rewrite. This preserves product compatibility and makes upstream drift visible, at the cost of continuous rebase work and the need to keep patches small.

## Considered options

- A history-preserving fork maximizes diff and merge visibility.
- A vendor subtree simplifies repository ownership but obscures upstream history.
- A clean-room rewrite maximizes control but discards working security and product behavior.

The initial recommendation is a history-preserving fork. Milestone 0 validates the exact repository mechanics before this record is accepted.
