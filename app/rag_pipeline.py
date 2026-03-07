# The LangChain logic (Embeddings + LLM + Prompts)
import os
from langchain_groq import ChatGroq
from langchain.prompts import ChatPromptTemplate
from .database import search_trusted_context

def verify_claim(user_query: str) -> str:
    """
    The 'Handshake' function: Takes a string and returns the AI's verdict[cite: 165, 166].
    """
    # 1. Retrieve trusted facts from ChromaDB [cite: 133, 151]
    context = search_trusted_context(user_query)
    
    # 2. Setup the LLM (using Groq for high speed) [cite: 74, 138]
    llm = ChatGroq(temperature=0, model_name="llama3-70b-8192", api_key=os.getenv("GROQ_API_KEY"))
    
    # 3. Create the strict system prompt to prevent hallucinations [cite: 195, 199]
    system_prompt = (
        "You are Trusteefy, a strict fact-checking assistant. "
        "Base your answer SOLELY on the provided <TRUSTED_CONTEXT>. "
        "If you cannot find the answer, say you cannot verify it[cite: 54, 200]."
    )
    
    prompt = ChatPromptTemplate.from_messages([
        ("system", system_prompt),
        ("human", "Context: {context}\n\nClaim: {query}")
    ])
    
    # 4. Generate and return the localized response [cite: 145, 153]
    chain = prompt | llm
    response = chain.invoke({"context": context, "query": user_query})
    
    return response.content