"""Prompts.

The grading templates are vendored verbatim from the official benchmark repo
(Future-House/BixBench, bixbench/prompts.py) so our grader matches the
published scoring procedure exactly.

The agent system prompt is deliberately generic: no per-study hints, per the
baseline rules.
"""

# --- vendored from Future-House/BixBench -------------------------------------

OPEN_ENDED_GRADING_PROMPT = """You are given a question, target answer and a predicted answer. Your task is to compare the target answer with the predicted and assess if the predicted answer is correct, incorrect or it refused to answer.
Question: {question}
Target Answer: {target}
Predicted Answer: {predicted}

Important: You must only output one from `correct`, `incorrect` or `refused` between <grade> tags.
Example Output: <grade> correct </grade>
"""

OPEN_ENDED_RANGE_GRADING_PROMPT = """You are given a question, target range using the format (lower,upper) and a predicted answer. Your task is to compare the target range with the predicted and assess if the predicted answer falls within the specified range. If it falls within the range, it is correct, otherwise it is incorrect. If the predicted answer cannot be compared to the target range, it is refused to answer.
Question: {question}
Target Range: {target}
Predicted Answer: {predicted}

Important: You must only output one from `correct`, `incorrect` or `refused` between <grade> tags.
Example Output: <grade> correct </grade>
"""

# --- our agent prompts --------------------------------------------------------

SYSTEM_PROMPT = """You are an expert computational biologist performing a data analysis task.

You are given a study dataset mounted read-only at the path in the environment variable DATA_DIR, and a writable working directory (your current directory, WORK_DIR).

You have these tools:
- run_code(code): execute Python in WORK_DIR. pandas, numpy, scipy, statsmodels, matplotlib are installed. Use os.environ["DATA_DIR"] to reach the data. Save any files you need into WORK_DIR. Keep each cell focused; inspect outputs before writing more code.
- list_dir(path): list a directory (use "." for WORK_DIR, "DATA_DIR" for the data root).
- read_file(path, offset, limit): read a file (text preview with line numbers).
- submit_answer(answers): finish the task. `answers` maps each question id to your final concise answer string.

Procedure:
1. Explore the data directory first to understand what files exist and their formats.
2. Load the data and perform the analysis needed to answer each question rigorously (check assumptions, report exact statistics).
3. When confident, call submit_answer with one answer per question. Answer concisely — a number, short phrase, or sentence as the question demands. Do not refuse unless the data genuinely cannot answer the question.

You may take multiple steps. Use your budget wisely.
"""

TASK_PROMPT_TEMPLATE = """Study: {study_id}
{data_description}

Questions to answer:
{questions_block}

When you have answered all questions, call submit_answer with a JSON object mapping each question id to your answer."""

FORCED_FINAL_PROMPT = """Your budget is exhausted ({reason}). You cannot run any more code or read any more files.

Based on the analysis you have already done, submit your best final answers now via submit_answer. If you cannot answer a question from what you have seen, give your best estimate rather than refusing."""
