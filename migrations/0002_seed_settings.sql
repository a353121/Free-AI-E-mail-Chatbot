-- 0002_seed_settings.sql — default runtime settings
-- Precedence: settings table > [vars] > built-in defaults.

INSERT INTO settings (key, value, updated_at) VALUES
  ('system_instructions', 'You are a helpful, concise AI email assistant. You reply by email to people writing to your address. Use tools when they genuinely improve your answer. Never invent facts: when unsure, say so or verify with a tool.', 0),
  ('default_llm', 'openrouter/free', 0),
  ('llm_model', '', 0),
  ('llm_provider', 'openrouter', 0),
  ('llm_base_url', '', 0),
  ('llm_api_key', '', 0),
  ('delivery_provider', 'brevo', 0),
  ('max_agent_steps', '8', 0),
  ('max_tool_result_bytes', '8192', 0),
  ('parallel_tools', '4', 0),
  ('subrequest_budget', '40', 0),
  ('context_caps', '{"system":1500,"summary":1000,"turns":4000,"email":6000,"attachment":2000,"tool_output":1500}', 0),
  ('tools_enable', '', 0),
  ('tools_disable', '', 0),
  ('tools_default_surface', 'web_search,url_fetch,ddg_instant_answer,wikipedia_lookup,npm_package_lookup,pypi_package_lookup,weather_forecast,currency_exchange,convert_time,geo_ip_lookup,dns_lookup,current_time,safe_math,number_tools,json_toolbox,csv_to_json,summarize_text,extract_facts,diff_text,text_stats,text_transform,regex_extract,remember_fact', 0),
  ('intents', '{"support":{"keywords":["help","broken","issue","bug","fails","not working","error","support"],"tone":"helpful and direct","surface":["web_search","url_fetch","dns_lookup","remember_fact"]},"info":{"keywords":["what","who","where","when","how","please explain","tell me","summarize","status","update"],"tone":"informative","surface":["web_search","ddg_instant_answer","wikipedia_lookup","npm_package_lookup","pypi_package_lookup","weather_forecast","currency_exchange","crypto_prices"]},"action":{"keywords":["calculate","create","check","fetch","convert","send","prepare","build","generate","diff"],"tone":"actionable","surface":["safe_math","number_tools","json_toolbox","csv_to_json","diff_text","convert_time","current_time","url_status","base64_codec","hash_sha"]},"personal":{"keywords":["remember","my","i like","i prefer","forget","about me"],"tone":"warm and concise","surface":["remember_fact"]}}', 0),
  ('rate_limit_per_sender_per_hour', '6', 0),
  ('rate_limit_global_per_day', '500', 0),
  ('guardrail_strictness', 'normal', 0),
  ('destructive_flags', '{"invoicing":false,"autopost":false,"outbound_social":false,"external_send":false}', 0),
  ('webhook_url', '', 0),
  ('digest_schedule', '0 7 * * *', 0),
  ('digest_enabled', 'false', 0),
  ('rag_enabled', 'false', 0),
  ('spam_email_domains', '', 0),
  ('debug_enabled', 'false', 0)
ON CONFLICT(key) DO NOTHING;
