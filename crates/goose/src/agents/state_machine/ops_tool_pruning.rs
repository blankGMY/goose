//! Deterministic pruning of old tool request/response pairs (Hermes-style).
//!
//! When the agent-visible conversation grows past a token budget, the oldest
//! bulky pairs outside the protected tail are hidden from the agent and
//! replaced by a single stub note. Unlike tool-pair summarization this makes
//! no model call: the stored messages keep their content and stay visible to
//! the user; only their agent visibility flips.

use anyhow::Result;
use async_trait::async_trait;

use crate::agents::state_machine::{
    applied, not_applicable, ConversationEffect, Emitter, GooseEffect, Operation, OperationResult,
};
use crate::context_mgmt::{message_content_chars, tool_pairs_to_prune};
use crate::conversation::message::{Message, MessageMetadata};
use crate::conversation::Conversation;
use crate::session::Session;

/// Rough chars-per-token used only for the budget trigger; the exact count
/// does not matter, the budget is a soft ceiling.
const CHARS_PER_TOKEN: usize = 3;

pub struct ToolPruningOperation {
    token_budget: usize,
    min_chars: usize,
    keep_turns: usize,
    enabled: bool,
    output: std::sync::Mutex<Vec<GooseEffect>>,
}

impl ToolPruningOperation {
    pub fn new(token_budget: usize, min_chars: usize, keep_turns: usize, enabled: bool) -> Self {
        Self {
            token_budget,
            min_chars,
            keep_turns,
            enabled,
            output: std::sync::Mutex::default(),
        }
    }

    fn take_output(&self) -> Vec<GooseEffect> {
        std::mem::take(&mut *self.output.lock().unwrap())
    }
}

#[async_trait]
impl Operation<Session, GooseEffect> for ToolPruningOperation {
    fn name(&self) -> &'static str {
        "tool_pruning"
    }

    async fn finalize_cancellation(
        &self,
        _session: &Session,
        _conversation: &Conversation,
        _emit: &Emitter,
    ) -> Vec<GooseEffect> {
        self.take_output()
    }

    async fn run(
        &self,
        _session: &Session,
        conversation: &Conversation,
        _emit: &Emitter,
    ) -> Result<OperationResult<GooseEffect>> {
        if !self.enabled {
            return not_applicable();
        }

        let total_chars: usize = conversation
            .messages()
            .iter()
            .filter(|message| message.is_agent_visible())
            .map(message_content_chars)
            .sum();
        let estimated_tokens = total_chars / CHARS_PER_TOKEN;
        if estimated_tokens <= self.token_budget {
            return not_applicable();
        }

        let chars_to_free = (estimated_tokens - self.token_budget) * CHARS_PER_TOKEN;
        let candidates = tool_pairs_to_prune(
            conversation,
            self.keep_turns.max(1),
            self.min_chars,
            chars_to_free,
        );
        if candidates.is_empty() {
            return not_applicable();
        }

        let mut total_pruned_chars = 0usize;
        let mut tool_names: Vec<String> = Vec::new();
        {
            let mut effects = self.output.lock().unwrap();
            let mut hidden: std::collections::HashSet<String> = Default::default();
            for candidate in &candidates {
                total_pruned_chars += candidate.total_chars;
                if !tool_names.contains(&candidate.tool_name) {
                    tool_names.push(candidate.tool_name.clone());
                }
                for (message_id, user_visible) in &candidate.messages {
                    if hidden.insert(message_id.clone()) {
                        effects.push(
                            ConversationEffect::SetMessageVisibility {
                                message_id: message_id.clone(),
                                user_visible: *user_visible,
                                agent_visible: false,
                            }
                            .into(),
                        );
                    }
                }
            }

            let stub_text = format!(
                "[Context pruning: {} earlier tool call(s) totaling {} characters were \
                 hidden to save context (tools: {}). The original results remain in the \
                 session record; re-run a tool if you need its output again.]",
                candidates.len(),
                total_pruned_chars,
                tool_names.join(", "),
            );
            let mut stub = Message::user().with_text(stub_text);
            stub.created = candidates
                .iter()
                .map(|candidate| candidate.last_created)
                .max()
                .unwrap_or(0);
            stub.metadata = MessageMetadata::agent_only();
            effects.push(stub.with_generated_id().into());
        }

        let effects = self.take_output();
        if effects.is_empty() {
            not_applicable()
        } else {
            applied(effects)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rmcp::model::{CallToolRequestParams, CallToolResult, ContentBlock as RmcpContent};

    fn tool_pair(id: &str, output_chars: usize) -> Vec<Message> {
        vec![
            Message::assistant()
                .with_tool_request(id, Ok(CallToolRequestParams::new("read_file")))
                .with_generated_id(),
            Message::user()
                .with_tool_response(
                    id,
                    Ok(CallToolResult::success(vec![RmcpContent::text(
                        "x".repeat(output_chars),
                    )])),
                )
                .with_generated_id(),
        ]
    }

    fn conversation_with_pairs() -> Conversation {
        let mut messages = vec![Message::user().with_text("start").with_generated_id()];
        messages.extend(tool_pair("t1", 3_000));
        messages.push(Message::user().with_text("next").with_generated_id());
        messages.extend(tool_pair("t2", 3_000));
        messages.push(Message::user().with_text("current").with_generated_id());
        Conversation::new_unvalidated(messages)
    }

    #[test]
    fn prunes_oldest_pair_first_and_stops_at_target() {
        let conversation = conversation_with_pairs();
        let selected = tool_pairs_to_prune(&conversation, 1, 2_000, 3_000);
        assert_eq!(selected.len(), 1);
        assert_eq!(selected[0].tool_name, "read_file");
        assert!(selected[0].total_chars >= 3_000);
        assert_eq!(selected[0].messages.len(), 2);
    }

    #[test]
    fn prunes_both_pairs_when_target_is_large() {
        let conversation = conversation_with_pairs();
        let selected = tool_pairs_to_prune(&conversation, 1, 2_000, 1_000_000);
        assert_eq!(selected.len(), 2);
    }

    #[test]
    fn protected_tail_covers_pairs_inside_kept_turns() {
        let conversation = conversation_with_pairs();
        // Keeping 3 user turns protects everything: the oldest pair sits in
        // the first kept turn.
        let selected = tool_pairs_to_prune(&conversation, 3, 2_000, 1_000_000);
        assert!(selected.is_empty());
    }

    #[test]
    fn small_pairs_are_left_alone() {
        let mut messages = vec![Message::user().with_text("start").with_generated_id()];
        messages.extend(tool_pair("t1", 100));
        messages.push(Message::user().with_text("current").with_generated_id());
        let conversation = Conversation::new_unvalidated(messages);
        let selected = tool_pairs_to_prune(&conversation, 1, 2_000, 1_000_000);
        assert!(selected.is_empty());
    }
}
