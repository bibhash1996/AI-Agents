import "dotenv/config";

// import { ChatOpenAI } from "langchain/chat_models/openai";
import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";

const openAiApiKey = process.env.OPENAI_API_KEY;

const llm = new ChatOpenAI({ apiKey: openAiApiKey });

const template =
  "Generate a promotional tweet for a product, frm the product description {productDesc}";

const prompt = PromptTemplate.fromTemplate(template);

const chain = prompt.pipe(llm);

const response = await chain.invoke({ productDesc: "Note taking app" });

console.log(response.content);
