"""bixbase: single-agent baseline + shared infrastructure for BixBench3.

The swarm implementation must reuse these interfaces so the comparison is fair:
    loader.load_studies(source) -> list[Study]
    agent.solve(study, budget, ...) -> SolveResult
    grader.grade_study(study, answers, ...) -> list[GradeResult]
    sandbox.Sandbox(study.data_dir, work_dir) -> isolated code execution
    budget.Budget(caps) -> shared accounting for every model call + tool call
"""

__version__ = "0.1.0"
