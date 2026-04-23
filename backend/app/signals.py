from typing import Literal

TradeSignal = Literal["buy", "sell", "hold"]


def calculate_ma120_fields(price: float, ma120: float) -> dict[str, float | TradeSignal]:
    lower = round(ma120 * 0.88, 2)
    upper = round(ma120 * 1.12, 2)

    if price < lower:
        signal: TradeSignal = "buy"
    elif price > upper:
        signal = "sell"
    else:
        signal = "hold"

    return {
        "ma120": round(ma120, 2),
        "ma120_lower": lower,
        "ma120_upper": upper,
        "signal": signal,
    }
