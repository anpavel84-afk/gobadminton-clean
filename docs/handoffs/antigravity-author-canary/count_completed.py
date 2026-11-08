"""Count completed items."""


def count_completed(values):
    """Return the number of elements that are exactly the boolean True."""
    return sum(1 for value in values if value is True)
