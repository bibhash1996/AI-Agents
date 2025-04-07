import logging
import time
from typing import Dict, List, Union, Literal, Tuple, Optional
import os
from dotenv import load_dotenv

from langchain_core.messages import (
    AIMessage, 
    HumanMessage, 
    SystemMessage,
    FunctionMessage
)
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from agents import (python_coding_agent,
                    javascript_coding_agent)

load_dotenv()

# Set up logging
logger = logging.getLogger('language_agents')


def get_language_coding_agent(language: str):
    if language == "python":
        return python_coding_agent
    elif language == "javaScript":
        return javascript_coding_agent
    else:
        # Default to Python if language is not recognized
        return python_coding_agent
    

def getLanguageSpecificCode(state: dict) -> Tuple[str, str]:
    messages = state['messages']
    plan = state['plan']
    language = state['language']
    if not language:
        language = 'python'
    
    # Get the appropriate coding agent
    coding_agent = get_language_coding_agent(language)
    
    # Add a specific instruction for the coding agent
    coding_instruction = HumanMessage(
        content=f"""Based on this plan:

{plan}

Please implement the complete code in {language}. Make sure to:
1. Include all necessary imports/dependencies
2. Implement all functions and classes mentioned in the plan
3. Add appropriate comments and documentation
4. If the implementation requires multiple files, clearly indicate each file with a filename header

For multiple files, use this format:
```
// FILENAME: example.js
// Code for example.js goes here
```

```
/* FILENAME: styles.css */
/* Code for styles.css goes here */
```

```python
# FILENAME: app.py
# Code for app.py goes here
```

Make sure each file is properly formatted and includes all necessary code.
"""
        )
    coding_messages = messages + [coding_instruction]
    
    response = coding_agent.invoke({"messages": coding_messages})
    
    # Extract the code from the response
    content = response.content
    print("Code : " , content)
    
    return content