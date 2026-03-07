import os
import logging
from langchain_groq import ChatGroq
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from .database import search_trusted_context

logger = logging.getLogger(__name__)

ACTIVE_ENGINE = "groq" 

def summarize_long_claim(text: str) -> str:
    if len(text) < 500:
        return text
    logger.info("Claim is long. Summarizing before fact-check...")
    llm_summarizer = ChatOpenAI(model="gpt-4o-mini", temperature=0)
    summary_prompt = ChatPromptTemplate.from_messages([
        ("system", "You are a claim extractor. Identify the primary factual claim. Output ONLY the distilled claim in a single sentence."),
        ("human", "{text}")
    ])
    chain = summary_prompt | llm_summarizer
    response = chain.invoke({"text": text})
    return response.content.strip()

def _get_llm(engine: str):
    """Factory to get the active LLM."""
    if engine == "groq":
        return ChatGroq(model_name="llama-3.3-70b-versatile", temperature=0)
    return ChatOpenAI(model="gpt-4o-mini", temperature=0)

def verify_claim(user_query: str) -> str:
    if len(user_query) > 500:
        user_query = summarize_long_claim(user_query)
        logger.info(f"Distilled Claim: {user_query}")

    context = search_trusted_context(user_query)
    
    # IMPROVED FALLBACK: If context is empty OR very short (likely junk/noise)
    # We check if it has fewer than 15 words.
    if not context.strip() or len(context.split()) < 15:
        logger.info("No substantial local data found. Forcing OpenAI General Knowledge...")
        try:
            llm_general = ChatOpenAI(model="gpt-4o-mini", temperature=0.3)
            general_prompt = ChatPromptTemplate.from_messages([
                ("system", "You are TrustBytes. You found no local official data. Provide a helpful, general answer based on your internal knowledge. Always respond in English unless the user query is clearly in another language. Advise the user to check official sources."),
                ("human", "{user_query}")
            ])
            chain = general_prompt | llm_general
            response = chain.invoke({"user_query": user_query})
            return f"*General Web Knowledge:*\n\n{response.content}"
        except Exception:
            return "I cannot verify this information right now."

    # THE RAG PROMPT with Strict Language Rules
    prompt = ChatPromptTemplate.from_messages([
        ("system", """You are OmniSource, a strict fact-checking assistant.
        
        CRITICAL RULES:
        1. DEFAULT LANGUAGE: Always respond in English. Only use Chinese, Malay, or Tamil if the <user_claim> is clearly and entirely in that language. If the transcription looks like a mistake or 'Singlish' (English with a few local words), STAY IN ENGLISH.
        2. VERDICT: Start with 🔴 FALSE, 🟢 TRUE, 🟡 MISLEADING, or ⚪ UNVERIFIED.
        3. Explain the truth using ONLY the TRUSTED_CONTEXT provided.
        4. NEVER mention internal terms like 'TRUSTED_CONTEXT' or 'user_query'.
        """),
        ("human", "TRUSTED_CONTEXT:\n{context}\n\n<user_claim>\n{user_query}\n</user_claim>")
    ])

    try:
        llm = _get_llm(ACTIVE_ENGINE)
        chain = prompt | llm
        return chain.invoke({"context": context, "user_query": user_query}).content
    except Exception:
        # Fallback to the other engine
        fallback_engine = "openai" if ACTIVE_ENGINE == "groq" else "groq"
        llm = _get_llm(fallback_engine)
        chain = prompt | llm
        return chain.invoke({"context": context, "user_query": user_query}).content