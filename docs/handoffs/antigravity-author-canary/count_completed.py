"""Count completed items."""


def count_completed(values, *, limit=None):
    """Return the number of elements that are exactly the boolean True.

    Optional limit must be a nonnegative int (not bool) and caps the result.
    """
    if limit is not None and (
        type(limit) is not int or limit < 0
    ):
        raise ValueError('limit must be a nonnegative int or None')
    count = 0
    if limit == 0:
        return 0
    for value in values:
        if value is True:
            count += 1
            if limit is not None and count >= limit:
                break
    return count
