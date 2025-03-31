import "dotenv/config";

import { ChatOpenAI } from "@langchain/openai";
import {
  Annotation,
  messagesStateReducer,
  StateGraph,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { TavilySearchResults } from "@langchain/community/tools/tavily_search";
import { HumanMessage } from "@langchain/core/messages";

const llm = new ChatOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  model: "gpt-3.5-turbo",
  temperature: 0,
});

const GraphState = Annotation.Root({
  messages: Annotation({
    reducer: messagesStateReducer,
  }),
});

const tavilyTool = new TavilySearchResults({
  maxResults: 2,
  apiKey: process.env.TAVILY_API_KEY,
});

const tools = [tavilyTool];

const llmWithTools = llm.bindTools(tools);
const toolNode = new ToolNode(tools);

function shouldContinue(state) {
  const lastMessage = state.messages[state.messages.length - 1];
  if (lastMessage?.tool_calls?.length) {
    return "tools";
  }
  // Otherwise, we stop (reply to the user) using the special "__end__" node
  return "__end__";
}

async function callModel(state, config) {
  const response = await llmWithTools.invoke(
    [
      {
        role: "system",
        content:
          "You are a helpful assistant tasked with performing web search operations.",
      },
      ...state.messages,
    ]
    // config
  );

  // We return a list, because this will get added to the existing list
  return { messages: [response] };
}

const workflow = new StateGraph(GraphState)
  .addNode("agent", callModel)
  .addNode("tools", toolNode)
  .addEdge("__start__", "agent")
  .addConditionalEdges("agent", shouldContinue)
  .addEdge("tools", "agent");
// Finally, we compile it into a LangChain Runnable.

const app = workflow.compile();

// Use the agent
const finalState = await app.invoke({
  messages: [
    new HumanMessage(
      "Can yuu give me a list of flight details from bangalore to patna for tomorrow?"
    ),
  ],
});
// console.log(finalState);
console.log(finalState.messages[finalState.messages.length - 1].content);

// const nextState = await app.invoke({
//   // Including the messages from the previous run gives the LLM context.
//   // This way it knows we're asking about the weather in NY
//   messages: [...finalState.messages, new HumanMessage("what about chennai")],
// });

// console.log(nextState.messages[nextState.messages.length - 1].content);
