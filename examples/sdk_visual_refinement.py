"""Example: Recursive Visual Refinement with RiskModels SDK.

This example demonstrates the MatPlotAgent pattern for generating
professional financial visualizations through Vision-LLM feedback.

Requirements:
    pip install riskmodels-py openai matplotlib

Environment:
    RISKMODELS_API_KEY=your_api_key
    OPENAI_API_KEY=your_openai_key
"""

import os

from openai import OpenAI
from riskmodels import RiskModelsClient


def main():
    """Run visual refinement examples."""
    # Initialize clients
    client = RiskModelsClient.from_env()
    llm = OpenAI(api_key=os.environ["OPENAI_API_KEY"])

    # Example 1: L3 Risk Decomposition Area Chart
    print("Example 1: L3 Risk Decomposition for NVDA")
    print("-" * 50)

    result = client.generate_refined_plot(
        plot_description="""
        Create a stacked area chart showing L3 risk decomposition for NVDA over 2 years.
        Include: Market Risk (indigo), Sector Risk (green), Subsector Risk (blue),
        and Residual Risk (gray).
        X-axis: dates, Y-axis: explained risk (0-100%).
        Add title, legend, and proper financial formatting.
        """,
        output_path="nvda_l3_decomposition.png",
        llm_client=llm,
        max_iterations=5,
    )

    print(f"Success: {result.success}")
    print(f"Iterations: {result.iterations}")
    print(f"Output: {result.output_path}")
    if result.warning:
        print(f"Warning: {result.warning}")
    print()

    # Example 2: Hedge Ratio Time Series
    print("Example 2: L3 Hedge Ratios for AAPL")
    print("-" * 50)

    result = client.generate_refined_plot(
        plot_description="""
        Create a multi-line time series plot of L3 hedge ratios for AAPL over 1 year.
        Show three lines: l3_market_hr (indigo), l3_sector_hr (green), l3_subsector_hr (blue).
        Include horizontal reference line at y=0.
        Proper labels, legend, and financial formatting.
        """,
        output_path="aapl_hedge_ratios.png",
        llm_client=llm,
        max_iterations=5,
    )

    print(f"Success: {result.success}")
    print(f"Iterations: {result.iterations}")
    print(f"Output: {result.output_path}")
    print()

    # Example 3: Using MatPlotAgent directly for more control
    print("Example 3: Direct MatPlotAgent Usage")
    print("-" * 50)

    from riskmodels.visual_refinement import MatPlotAgent

    agent = MatPlotAgent(
        client=client,
        llm_client=llm,
        llm_provider="openai",
        model="gpt-4o",
    )

    result = agent.generate_refined_plot(
        plot_description="""
        Create a bar chart comparing l3_market_hr across MAG7 stocks (AAPL, MSFT, AMZN,
        GOOG, META, TSLA, NVDA). Use indigo bars. Sort by value descending.
        Professional styling with value labels on bars.
        """,
        output_path="mag7_market_beta.png",
        max_iterations=3,
    )

    print(f"Success: {result.success}")
    print(f"Iterations: {result.iterations}")
    print(f"Output: {result.output_path}")
    print()

    # Print evaluation history
    print("Evaluation History:")
    for eval_entry in result.evaluation_history:
        print(f"  Iteration {eval_entry['iteration']}: ", end="")
        if eval_entry.get("is_complete"):
            print("COMPLETE")
        elif not eval_entry.get("execution_success"):
            print("EXECUTION ERROR")
        else:
            print(f"Feedback: {eval_entry['feedback'][:80]}...")


if __name__ == "__main__":
    main()
