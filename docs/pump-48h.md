# 48 hours of pump.fun: 52,552 launches, 159 alive

Our north node reads every launch and every trade on pump.fun from the first second. We took two full days of that tape, 11 to 13 November 2026, and counted what happened to every coin: 52,552 launches and 5.4 million trades.

![52,552 coins launched, 159 are alive](/research/1-cover.png)

## How we counted

The lines are the ones in [How calls are graded](grading.md). A coin is **dead** when its curve is back under 32 SOL of market cap (every coin opens at about 28), or when it graduated and its pool holds under 0.4 SOL. It is **alive** when the curve holds 85 SOL of cap or more, or the pool holds 4 SOL or more. Everything else is in between. The coins were between 3 and 48 hours old when we looked.

## 97.8% dead, 0.3% alive

51,417 of 52,552 were dead and 159 were alive: 3 coins in every 1,000.

The hour of the launch changes nothing. Split into six blocks of four hours, the share of dead coins sits between 97.6% and 98.1% in every one.

## 44% of coins never got a fifth buyer

![How many wallets ever bought the coin](/research/2-buyers.png)

2,387 coins were never bought by anyone, the dev included. Another 20,785 had between one and four buyers, and the dev is usually one of them. Two thirds of all launches never reached ten buyers.

A crowd is not enough either. Of the 3,469 coins with 50 buyers or more, 84.9% were dead. The numbers only move at 250 buyers: 926 coins got there, and 11% of them were alive.

## Half of all devs sell within 30 seconds

![Share of launches where the dev had already sold](/research/3-dev.png)

The dev wallet sold in 88% of launches. The median time from launch to the dev's first sell is 24 seconds.

| Time since launch | Launches where the dev had sold |
| --- | --- |
| 5 seconds | 17% |
| 30 seconds | 49% |
| 1 minute | 62% |
| 1 hour | 85% |

Among the 159 coins that survived, the dev had sold in 124. Nearly every dev sells, so a dev who sold says little on its own.

## The bundled coins died less often

![Share of coins dead, by launch-block wallets](/research/4-bundles.png)

A bundle here is wallets other than the dev buying in the launch block or the next one.

| Launch | Coins | Dead | Alive |
| --- | --- | --- | --- |
| No bundle | 43,301 | 99.6% | 8 |
| 10+ wallets, under 30% of supply | 2,498 | 94.2% | 42 |
| 10+ wallets, 30% of supply or more | 2,707 | 78.3% | 107 |

107 of the 159 survivors came from the last row, and 24% of the coins in it graduated.

None of this makes a bundled coin a good buy: 78% dead is a terrible bet. What the tape shows is narrower. A coin nobody bundled or sniped is a coin nobody showed up for, and it dies almost every time. From the block alone we cannot tell one hand with ten wallets from ten separate snipers.

This is why a launch bundle stopped being a reason to avoid in our check on 28 October 2026.

## Graduating is not surviving

![What happened to the coins that left the bonding curve](/research/5-graduated.png)

1,357 coins graduated, 2.6% of all launches. Less than two days later 474 of them had a pool under 0.4 SOL, and 143 had a pool of 4 SOL or more.

## What this does not say

- Two days is two days. Another week may look different, and a coin that was 3 hours old when we looked had less time to die than one that was 48.
- Alive means money is still in the coin. It says nothing about whether a buyer made money.
- It does not yet say what the early wallets do between minute 5 and minute 20, and whether that predicts the end. The node has written that down for every launch since 13 November 2026, and we will publish what it shows.
