import "dotenv/config";
import pg from "pg"; // Import PostgreSQL client
import { ChatOpenAI } from "@langchain/openai";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { ChatPromptTemplate, PromptTemplate } from "@langchain/core/prompts";
import { RunnableSequence } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";
import readline from "readline";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const GraphState = {
  question: null,
  schema: null,
  query: null,
  relevant: null,
  result: null,
  query_result: null,
  human_readable_response: null,
};

function humanReadableArray(arr, options = {}) {
  const {
    separator = ", ",
    lastSeparator = " and ",
    keyFormatter = (key) => key.replace(/_/g, " ").toUpperCase(),
    valueFormatter = (value) => value,
  } = options;

  return arr
    .map((obj) => {
      return Object.entries(obj)
        .map(([key, value]) => `${keyFormatter(key)}: ${valueFormatter(value)}`)
        .join("; ");
    })
    .join(separator)
    .replace(/,([^,]*)$/, lastSeparator + "$1");
}

const llm = new ChatOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  model: "gpt-3.5-turbo",
  temperature: 0,
});

// PostgreSQL Configuration
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

// Function to Get Database Schema
const getDatabaseSchema = async () => {
  try {
    const client = await pool.connect();
    const tablesQuery = `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `;
    const tablesResult = await client.query(tablesQuery);
    const tables = tablesResult.rows.map((row) => row.table_name);
    let schema = "";
    for (const table of tables) {
      schema += `Table : ${table} \n`;
      const columnsQuery = `
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = '${table}';
      `;
      const columnsResult = await client.query(columnsQuery);
      let rows = "";
      for (let row of columnsResult.rows) {
        rows += `${row.column_name} : ${row.data_type} ,`;
      }
      schema += `Columns ${rows}`;
      schema += "\n";
    }
    client.release();
    return schema;
  } catch (err) {
    console.error("Error fetching schema:", err);
    throw err;
  }
};

async function isQuestionRelevant(state) {
  console.log("=========================================");
  console.log("          CHECK RELEVANCE                ");
  console.log("=========================================");
  let schema = state.schema;
  let question = state.question;
  //   console.log(state);
  if (!state.question) {
    console.error("❌ Error: Question is missing from state!");
    return { ...state, relevant: "not_relevant" };
  }
  console.log(`Checking relevance of the question: ${question}`);
  let SYSTEM = `You are an assistant that determines whether a given question is related to the following database schema.
                Schema: ${schema}
                Question: ${question}
                Respond with only single word as  "relevant" or "not_relevant
                Response:
                `;
  const prompt = PromptTemplate.fromTemplate(SYSTEM);
  const chain = RunnableSequence.from([
    prompt,
    llm,
    new StringOutputParser(),
    {
      relevance: (prev) => prev,
    },
  ]);
  const response = await chain.invoke();
  console.log(
    "Relevance : ",
    response?.relevance.toLowerCase() || "not_relevant"
  );
  return {
    ...state,
    relevant: response?.relevance.toLowerCase() || "not_relevant",
  };
}

function shouldContinue(state) {
  const relevant = state.relevant;
  if (relevant == "relevant") {
    return "yes";
  }
  return "no";
}

async function getSchema(state) {
  console.log("=========================================");
  console.log("          GETTING SCHEMA                ");
  console.log("=========================================");

  if (!state.question) {
    console.error("❌ Error: Question is missing from state!");
    return { ...state, relevant: "not_relevant", schema: "Schema not found" };
  }
  const schema = await getDatabaseSchema();
  return {
    ...state,
    schema: schema || "Schema not found",
  };
}

async function generateFunnyResponse(state) {
  console.log("=========================================");
  console.log("       GENERATING FUNNY RESPONSE         ");
  console.log("=========================================");
  let system = `You are a charming and funny assistant who responds in a playful manner.`;
  let human_message =
    "I can not help with that, but doesn't asking questions make you hungry? You can always order something delicious.";

  const prompt = ChatPromptTemplate.fromMessages([
    ["system", system],
    ["human", human_message],
  ]);

  const chain = prompt.pipe(llm).pipe(new StringOutputParser());
  const response = await chain.invoke();
  console.log("Response : ", response);
  return {
    ...state,
    result: response,
  };
}

async function convertToSQL(state) {
  console.log("=========================================");
  console.log("          CONVERTING TO SQL                ");
  console.log("=========================================");
  const schema = state.schema;
  const question = state.question;
  const sytemMesssage = `
    You are an assistant that converts natural language questions into SQL queries based on the following schema:
    ${schema}
    Provide only the SQL query without any explanations. Alias columns appropriately to match the expected keys in the result.
    For example, alias 'Campus.name' as 'campus_name' and 'Campus.type' as 'campus_type'.

    Also to note : 
    1. Never generate queries that update the table. Restrict the queries to only Database reads.
    2. Always use double quotes for table names and column names.
    3. Also limit the result rows to maximum 100 rows
    
    Question: ${question}
    `;

  const prompt = PromptTemplate.fromTemplate(sytemMesssage);
  const chain = RunnableSequence.from([
    prompt,
    llm,
    new StringOutputParser(),
    { query: (prev) => prev },
  ]);
  const response = await chain.invoke();
  console.log("QUERY : ", response.query);
  return {
    ...state,
    query: response.query,
  };
}

async function executeSql(state) {
  console.log("=========================================");
  console.log("          EXECUTING SQL QUERY             ");
  console.log("=========================================");
  const query = state.query;
  try {
    const client = await pool.connect();
    const response = await client.query(query);
    console.log(response.rows);
    client.release();
    let result = humanReadableArray(response.rows);
    console.log("Query Result");
    console.log(result);
    return {
      query_result: result,
    };
  } catch (error) {
    return {
      ...state,
      query_result: `Error executing query : ${error.message}`,
    };
  }
}

async function generateHumarReadableResponse(state) {
  console.log("=========================================");
  console.log("    GENERATE HUMAN READABLE RESPONSE     ");
  console.log("=========================================");
  const question = state.question;
  const query = state.query;
  const result = state.query_result;
  console.log("Generating a human-readable answer.");
  const message = `You are an assistant that converts SQL query results into clear, natural language responses without including any identifiers like order IDs. Start the response with a friendly greeting.
  Human Question asked : ${question} \n
  Query Results : ${result} \n

  Try to understand the query results and generate the response accordingly

  Response : 
  `;
  const prompt = PromptTemplate.fromTemplate(message);

  const chain = RunnableSequence.from([
    prompt,
    llm,
    new StringOutputParser(),
    { message: (prev) => prev },
  ]);

  const response = await chain.invoke();
  console.log("AI Response : ", response.message);
  return {
    human_readable_response: response.message,
  };
}

const workflow = new StateGraph({ channels: GraphState })
  .addNode("getSchema", getSchema)
  .addNode("isRelevant", isQuestionRelevant)
  .addNode("convertToSQL", convertToSQL)
  .addNode("generateFunnyResponse", generateFunnyResponse)
  .addNode("executeSql", executeSql)
  .addNode("generateHumarReadableResponse", generateHumarReadableResponse)
  .addEdge(START, "getSchema")
  .addEdge("getSchema", "isRelevant")
  .addConditionalEdges("isRelevant", shouldContinue, {
    yes: "convertToSQL",
    no: "generateFunnyResponse",
  })
  .addEdge("convertToSQL", "executeSql")
  .addEdge("executeSql", "generateHumarReadableResponse")
  .addEdge("generateFunnyResponse", END)
  .addEdge("generateHumarReadableResponse", END);

const graph = workflow.compile();

// const response = await graph.invoke({
//   question: `Give me the Admin's email of campus with campusId 30fc191d-2297-4ae4-9e7c-19c7953a4687`,
//   //   question: "How are you?",
// });

// 1. can you get fee records of the class of campus with campusId 30fc191d-2297-4ae4-9e7c-19c7953a4687

// console.log("==================================");
// console.log(response.relevant);
// console.log(response.result);
// console.log(response.query);
// console.log(response.query_result);
// console.log(response.human_readable_response);
// console.log("==================================");

/**
 * main function
 */
async function main() {
  while (true) {
    const input = await new Promise((resolve) => {
      rl.question("⏳ Ask Something : ", resolve);
    });
    if (input == "exit") {
      console.log("Good Bye ");
      process.exit(0);
    }

    const response = await graph.invoke({
      question: input,
      //   question: "How are you?",
    });
    console.log("\n\n");
  }
}

main();

/**
 * ToDO:
 *  1. Human in the Loop Flow
 *  2.
 */
