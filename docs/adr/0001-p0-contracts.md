---
status: accepted
---

# P0采用追加事件、不可变版本和有来源事实图谱

WordHub P0以SQLite/JSONL可实现的追加事件作为恢复与审计底座，以不可变Revision承载文档变更，以Fact和Graph保存可追溯知识；协调器是唯一的版本提升者，推演分支必须标记`canon=false`。这样可以在Pi运行时、编辑器和模型更换时保持可重放，并把“模型提出”与“用户确认”明确分开。
