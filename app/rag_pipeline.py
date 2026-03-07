import os
from langchain_groq import ChatGroq
from langchain_core.prompts import ChatPromptTemplate
from .database import search_trusted_context

def verify_claim(user_query: str) -> str:
    # 1. Get facts from ClickHouse
    context = search_trusted_context(user_query)
    
    if not context.strip():
        return "I cannot verify this information with my current trusted sources." # Failsafe

    # 2. Setup LLM
    llm = ChatGroq(model_name="llama3-70b-8192", temperature=0)

    # 3. Use the strict System Prompt from the Spec
    prompt = ChatPromptTemplate.from_messages([
        ("system", """You are TybtesBot, a strict fact-checking assistant.
        Your ONLY job is to compare the USER_MESSAGE against the TRUSTED_CONTEXT.
        Base your answer SOLELY on the TRUSTED_CONTEXT.
        If the context doesn't have the answer, say you cannot verify it."""),
        ("human", f"TRUSTED_CONTEXT:\n{context}\n\nUSER_MESSAGE:\n{user_query}")
    ])

    # 4. Generate Response
    chain = prompt | llm
    response = chain.invoke({"context": context, "user_query": user_query})
    
    return response.content