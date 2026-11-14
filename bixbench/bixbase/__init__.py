"""bixbase: single-agent baseline for BixBench v1 (HF futurehouse/BixBench).

Not BixBench3: that benchmark and the GLHF swarm live in glhf/bixbench and do
not use this package (see the repository AGENTS.md).

Interfaces:
    loader.load_studies(source) -> list[Study]
    loader.prepare_study_data(study, cache_dir) -> Path
    agent.solve(study, budget, ...) -> SolveResult
    grader.grade_answer(question, target, predicted, eval_mode, llm, budget)
        -> GradeResult   (one question; run.py loops over study.questions)
    grader.compute_metrics(grades, is_refused) -> dict
    sandbox.Sandbox(study.data_dir, work_dir) -> isolated code execution
    budget.Budget(caps) -> shared accounting for every model call + tool call
    paid.refuse_paid(what) -> the NO_PAID_CALLS switch
"""

__version__ = "0.1.0"
