import os
from typing import Dict, List, Annotated, TypedDict, Union, Literal
import json
import logging
import time
import sys
from dotenv import load_dotenv

from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.tools import tool
from langgraph.graph import StateGraph, END, START
from langgraph.prebuilt import ToolNode
from langgraph.checkpoint.memory import MemorySaver
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder,PromptTemplate
from langchain_openai import ChatOpenAI
from langchain_core.messages import (
    AIMessage, 
    HumanMessage, 
    SystemMessage,
    FunctionMessage,
    ChatMessage
)
from agents import (
    language_decider_agent,
    supervisor_agent,
    planning_agent
)
from language_specific_agent import getLanguageSpecificCode


load_dotenv()

# Set up logging
logger = logging.getLogger('language_agents')


apiKey = os.getenv('OPENAI_API_KEY')

MAX_ITERATIONS = 10

llm = None  # Define llm variable with a default value
try:
    llm = ChatOpenAI(api_key=apiKey,model='gpt-4o')
    logger.info("Successfully initialized openai model for language agents")
except Exception as e:
    logger.error(f"Failed to initialize openai model for language agents: {str(e)}", exc_info=True)
    print(f"Failed to initialize openai model for language agents: {str(e)}")
    # Create a dummy LLM that will raise an informative error if used
    class DummyLLM:
        def __call__(self, *args, **kwargs):
            raise RuntimeError("LLM initialization failed. Please check your API key and credentials.")
    llm = DummyLLM()



class GraphState(TypedDict):
    messages: List[Union[AIMessage, HumanMessage, SystemMessage, FunctionMessage]]
    task: str
    relevant:str
    plan: str
    code: str
    review: str
    test_results: str
    language: str  # Added language field to track which language was selected
    attempt: int  # Add attempt counter to prevent infinite loops
    next: Literal["decide_language","planning", "coding", "checking", "testing", "supervisor", "end"]


def isRelevant(state:GraphState) -> GraphState:
    task = state.get('task')
    promptMessage = f"""
    You are a code generator agent. Given the task below determine if the given task is related to code generation
    or not. 
    Task : {task}
    \n
    Respond with only single word as  "relevant" or "not_relevant"
    Response:
"""
    try:
        prompt = PromptTemplate.from_template(promptMessage)
        chain = prompt.pipe(llm)
        response = chain.invoke({})
        print("Checking relevancy : " , response.content)
        return {
            **state,
            "relevant":response.content
        }
    except Exception as e:
        print("Error checking relevancy : " , e.message)
        return {
            **state,
            "relevant":"not_relevant"
        }
    

def decideCodingLanguage(state:GraphState) -> GraphState:
    """
    To DO : Add a logic decider based on word usage 
    in the task. For now use llm directly
    """
    messages = state['messages']
    decider_instruction = HumanMessage(
            content="Based on the task description, which programming language would be most appropriate: Python, JavaScript, C++, or HTML/CSS? Respond with just the language name."
        )
    decider_messages = messages + [decider_instruction]
    response = language_decider_agent.invoke({"messages": decider_messages})
    print("Response for decide language: " , response.content)

    return {
        **state,
       "language":response.content.lower()
    }


    
def supervisor(state:GraphState) -> GraphState:
    messages = state["messages"]
    task = state.get("task", "")
    plan = state.get("plan", "")
    code = state.get("code", "")
    review = state.get("review", "")
    test_results = state.get("test_results", "")
    language = state.get("language", "")
    attempt = state.get('attempt')

    # If language is not decided yet then direct the graph to decide the language
    if not language and task:
        return {
            **state,
            "next": 'decide_language'
        }

    supervisor_instruction = HumanMessage(
            content=f"""Current state:
- Task: {task}
- Plan: {"Completed" if plan else "Not started"}
- Code: {"Completed" if code else "Not started"}
- Language: {language}
- Review: {"Completed" if review else "Not started"}
- Test Results: {"Completed" if test_results else "Not started"}
- Iteration: {attempt}/{MAX_ITERATIONS}

Based on the current state, decide which agent should work next:
1. Planning agent - if we need to create or update the plan
2. Coding agent - if we have a plan but need to implement the code
3. Checking agent - if we have code that needs to be reviewed
4. Testing agent - if we have code that needs to be tested
5. End - if the task is complete

Your decision should be one of: "planning", "coding", "checking", "testing", or "complete".

{"Test results indicate issues that need to be fixed: " + test_results if test_results and ("error" in test_results.lower() or "bug" in test_results.lower() or "fix" in test_results.lower() or "issue" in test_results.lower() or "fail" in test_results.lower()) else ""}
"""
        )
    supervisor_messages = messages + [supervisor_instruction]
    response  = supervisor_agent.invoke({"messages":supervisor_messages})
    print("Response for supervisor : " , response.content)
    messages.append(response.content.lower())
    return {
        **state,
        'next': response.content.lower(),
        'messages':messages
    }

def planning(state:GraphState) -> GraphState:
    messages = state['messages']
    language = state['language']
    instruction = HumanMessage(
            content=f"Based on the task description, create a detailed plan for implementing the code {language}."
        )
    planning_messages = messages + [instruction]
    response = planning_agent.invoke({"messages" : planning_messages})
    print("Planning response : "  , response.content)
    messages.append(response.content)

    return {
        **state,
        "messages":messages,
        "plan":response.content,
        "next":"supervisor"
    }

def coding(state:GraphState) -> GraphState:
    messages = state['messages']
    language = state['language']
    language_info_message = SystemMessage(
            content=f"The system has selected {language} as the most appropriate language for this task."
        )
    messages.append(language_info_message)
    code = getLanguageSpecificCode(state)
    print("Code : " , code)
    messages.append(SystemMessage(content=code))
    
    return {
        **state,
        'messages':messages,
        "code":code,
        "next":"supervisor"
    }


def shouldContinue(state:GraphState):
    relevant = state['relevant']
    if relevant == 'relevant':
        return "relevant"
    return "end"

def shouldSupervisorContinue(state:GraphState):
    nextStep = state['next']
    return nextStep

workflow = StateGraph(GraphState)
workflow.add_node('supervisor',supervisor)
workflow.add_node("isRelevant",isRelevant)
workflow.add_node("decide_language",decideCodingLanguage)
workflow.add_node("planning",planning)
workflow.add_node("coding",coding)
workflow.add_edge(START,"isRelevant")
workflow.add_conditional_edges('isRelevant',shouldContinue, {
    "relevant":"supervisor",
    "end":END
})

workflow.add_conditional_edges('supervisor',shouldSupervisorContinue , {
    "decide_language":"decide_language",
    "planning":"planning",
    "coding":"coding",
    "end":END
})

workflow.add_edge('decide_language','supervisor')
workflow.add_edge('planning','supervisor')
workflow.add_edge('coding','supervisor')

app = workflow.compile()

task ="Write me a Javascript code to add two variables"

response = app.invoke({
    "task":task,
    "messages":[HumanMessage(task)],
    "attempt":1
})

# print(response)