/**
 * Every product's cards for the chat, by the name its CLI prints (`::view <name> <ref>`). A
 * product adds its own here.
 */
import type { AgentViews } from "@wren/ui";
import { RESEARCH_REFS } from "../research/chat-card.js";
import { VIREO_REFS } from "../variants/chat-card.js";

export const VIEWS: AgentViews = { ...RESEARCH_REFS, ...VIREO_REFS };
