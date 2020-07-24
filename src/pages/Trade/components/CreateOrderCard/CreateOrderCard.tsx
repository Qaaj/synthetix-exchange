import React, { FC, useState, useEffect, useCallback } from 'react';
import { connect, ConnectedProps } from 'react-redux';
import styled from 'styled-components';
import { useTranslation } from 'react-i18next';
import isEmpty from 'lodash/isEmpty';

import snxJSConnector from 'utils/snxJSConnector';

import { ReactComponent as ReverseArrow } from 'assets/images/reverse-arrow.svg';

import Card from 'components/Card';
import NumericInputWithCurrency from 'components/Input/NumericInputWithCurrency';

import { getWalletInfo } from 'ducks/wallet/walletDetails';
import { getSynthsWalletBalances } from 'ducks/wallet/walletBalances';
import { getSynthPair, getAvailableSynthsMap } from 'ducks/synths';
import { getRatesExchangeRates, getEthRate } from 'ducks/rates';
import { RootState } from 'ducks/types';

import {
	getGasInfo,
	createTransaction,
	updateTransaction,
	getTransactions,
} from 'ducks/transaction';
import { toggleGweiPopup } from 'ducks/ui';

import { EMPTY_VALUE } from 'constants/placeholder';
import { BALANCE_FRACTIONS } from 'constants/order';
import { SYNTHS_MAP, CATEGORY_MAP } from 'constants/currency';
import { TRANSACTION_STATUS } from 'constants/transaction';

import { getExchangeRatesForCurrencies } from 'utils/rates';
import { normalizeGasLimit } from 'utils/transactions';
import { GWEI_UNIT } from 'utils/networkUtils';
import errorMessages from 'utils/errorMessages';
import {
	formatCurrency,
	bytesFormatter,
	bigNumberFormatter,
	secondsToTime,
} from 'utils/formatters';

import { Button } from 'components/Button';
import DismissableMessage from 'components/DismissableMessage';
import {
	FormInputRow,
	FormInputLabel,
	FormInputLabelSmall,
	resetButtonCSS,
	FlexDivCentered,
} from 'shared/commonStyles';

import NetworkInfo from './NetworkInfo';
import { bigNumberify } from 'ethers/utils';
import { INPUT_SIZES } from 'components/Input/constants';

const INPUT_DEFAULT_VALUE = '';

const mapStateToProps = (state: RootState) => ({
	synthPair: getSynthPair(state),
	walletInfo: getWalletInfo(state),
	synthsWalletBalances: getSynthsWalletBalances(state),
	exchangeRates: getRatesExchangeRates(state),
	gasInfo: getGasInfo(state),
	ethRate: getEthRate(state),
	transactions: getTransactions(state),
	synthsMap: getAvailableSynthsMap(state),
});

const mapDispatchToProps = {
	toggleGweiPopup,
	createTransaction,
	updateTransaction,
};

const connector = connect(mapStateToProps, mapDispatchToProps);

type PropsFromRedux = ConnectedProps<typeof connector>;

type CreateOrderCardProps = PropsFromRedux;

type OrderType = 'limit' | 'market';

const CreateOrderCard: FC<CreateOrderCardProps> = ({
	synthPair,
	walletInfo: { currentWallet, walletType },
	synthsWalletBalances,
	exchangeRates,
	gasInfo,
	ethRate,
	toggleGweiPopup,
	createTransaction,
	updateTransaction,
	transactions,
	synthsMap,
}) => {
	const { t } = useTranslation();
	const [orderType, setOrderType] = useState<OrderType>('market');
	const [baseAmount, setBaseAmount] = useState<string>(INPUT_DEFAULT_VALUE);
	const [quoteAmount, setQuoteAmount] = useState<string>(INPUT_DEFAULT_VALUE);
	const [limitPrice, setLimitPrice] = useState<string>(INPUT_DEFAULT_VALUE);
	const [feeRate, setFeeRate] = useState<number>(0);
	const [{ base, quote }, setPair] = useState(
		synthPair.reversed ? { base: synthPair.quote, quote: synthPair.base } : synthPair
	);
	const [tradeAllBalance, setTradeAllBalance] = useState<boolean>(false);
	const [gasLimit, setGasLimit] = useState(gasInfo.gasLimit);
	const [hasSetGasLimit, setHasSetGasLimit] = useState(false);
	const [inputError, setInputError] = useState<string | null>(null);
	const [txErrorMessage, setTxErrorMessage] = useState<string | null>(null);
	const [feeReclamationError, setFeeReclamationError] = useState<string | null>(null);
	const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
	const [hasMarketClosed, setHasMarketClosed] = useState<boolean>(false);

	const resetInputAmounts = () => {
		setBaseAmount(INPUT_DEFAULT_VALUE);
		setQuoteAmount(INPUT_DEFAULT_VALUE);
		setLimitPrice(INPUT_DEFAULT_VALUE);
	};

	const isLimitOrder = orderType === 'limit';
	const isMarketOrder = orderType === 'market';

	const showGweiPopup = () => toggleGweiPopup(true);
	const handleSwapCurrencies = () => {
		setPair({ quote: base, base: quote });
		resetInputAmounts();
	};

	useEffect(() => {
		if (synthPair.reversed) {
			setPair({ base: synthPair.quote, quote: synthPair.base });
		} else {
			setPair(synthPair);
		}
		resetInputAmounts();

		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [synthPair.base.name, synthPair.quote.name, synthPair.reversed]);

	useEffect(() => {
		const getFeeRateForExchange = async () => {
			try {
				const {
					snxJS: { Exchanger },
				} = snxJSConnector;
				const feeRateForExchange = await Exchanger.feeRateForExchange(
					bytesFormatter(quote.name),
					bytesFormatter(base.name)
				);
				setFeeRate(100 * bigNumberFormatter(feeRateForExchange));
			} catch (e) {
				console.log(e);
			}
		};
		getFeeRateForExchange();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [base.name, quote.name]);

	useEffect(() => {
		const {
			snxJS: { SystemStatus },
		} = snxJSConnector;
		const getIsSuspended = async () => {
			try {
				const [baseResult, quoteResult] = await Promise.all([
					SystemStatus.synthSuspension(bytesFormatter(synthPair.base.name)),
					SystemStatus.synthSuspension(bytesFormatter(synthPair.quote.name)),
				]);
				setHasMarketClosed(baseResult.suspended || quoteResult.suspended);
			} catch (e) {
				console.log(e);
			}
		};
		if ([base.category, quote.category].includes(CATEGORY_MAP.equities)) {
			getIsSuspended();
		} else {
			setHasMarketClosed(false);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [base.name, quote.name]);

	const baseBalance =
		(synthsWalletBalances && synthsWalletBalances.find((synth) => synth.name === base.name)) || 0;
	const quoteBalance =
		(synthsWalletBalances && synthsWalletBalances.find((synth) => synth.name === quote.name)) || 0;
	console.log(baseBalance);
	const rate = getExchangeRatesForCurrencies(exchangeRates, quote.name, base.name);
	const inverseRate = getExchangeRatesForCurrencies(exchangeRates, base.name, quote.name);

	const buttonDisabled =
		!baseAmount ||
		!currentWallet ||
		inputError != null ||
		isSubmitting ||
		feeReclamationError != null;

	const isEmptyQuoteBalance = !quoteBalance || !quoteBalance.balance;

	useEffect(() => {
		setInputError(null);
		if (!quoteAmount || !baseAmount) return;
		if (currentWallet && quoteAmount > quoteBalance.balance) {
			setInputError(t('common.errors.amount-exceeds-balance'));
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [quoteAmount, baseAmount, currentWallet, baseBalance, quoteBalance]);

	const getMaxSecsLeftInWaitingPeriod = useCallback(async () => {
		if (!currentWallet) return;
		const {
			snxJS: { Exchanger },
		} = snxJSConnector;
		try {
			const maxSecsLeftInWaitingPeriod = await Exchanger.maxSecsLeftInWaitingPeriod(
				currentWallet,
				bytesFormatter(quote.name)
			);
			const waitingPeriodInSecs = Number(maxSecsLeftInWaitingPeriod);
			if (waitingPeriodInSecs) {
				setFeeReclamationError(
					t('common.errors.fee-reclamation', {
						waitingPeriod: secondsToTime(waitingPeriodInSecs),
						currency: quote.name,
					})
				);
			} else setFeeReclamationError(null);
		} catch (e) {
			console.log(e);
			setFeeReclamationError(null);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [quote.name, currentWallet, quoteAmount]);

	useEffect(() => {
		getMaxSecsLeftInWaitingPeriod();
	}, [getMaxSecsLeftInWaitingPeriod]);

	useEffect(() => {
		const getGasEstimate = async () => {
			const {
				snxJS: { Synthetix },
				utils,
			} = snxJSConnector;

			if (!quoteAmount || !quoteBalance || hasSetGasLimit) return;
			const amountToExchange = tradeAllBalance
				? quoteBalance.balanceBN
				: utils.parseEther(quoteAmount.toString());

			const gasEstimate = await Synthetix.contract.estimate.exchange(
				bytesFormatter(quote.name),
				amountToExchange,
				bytesFormatter(base.name)
			);
			const rectifiedGasLimit = normalizeGasLimit(Number(gasEstimate));
			setGasLimit(rectifiedGasLimit);
			setHasSetGasLimit(true);
		};
		getGasEstimate();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [quoteAmount]);

	const setMaxBalance = () => {
		if (!isEmptyQuoteBalance) {
			setTradeAllBalance(true);
			setBaseAmount(`${Number(quoteBalance.balance) * rate}`);
			setQuoteAmount(quoteBalance.balance);
		}
	};

	const handleSubmit = async () => {
		const {
			limitOrdersContract,
			snxJS: { Synthetix },
			utils,
		} = snxJSConnector;
		const limitOrdersContractWithSigner = limitOrdersContract.connect(snxJSConnector.signer);

		const transactionId = transactions.length;
		setTxErrorMessage(null);
		setIsSubmitting(true);
		try {
			const amountToExchange = tradeAllBalance
				? quoteBalance.balanceBN
				: utils.parseEther(quoteAmount.toString());

			if (orderType === 'market') {
				const gasEstimate = await Synthetix.contract.estimate.exchange(
					bytesFormatter(quote.name),
					amountToExchange,
					bytesFormatter(base.name)
				);
				const rectifiedGasLimit = normalizeGasLimit(Number(gasEstimate));

				setGasLimit(rectifiedGasLimit);

				createTransaction({
					id: transactionId,
					date: new Date(),
					base: base.name,
					quote: quote.name,
					fromAmount: quoteAmount,
					toAmount: baseAmount,
					price:
						base.name === SYNTHS_MAP.sUSD
							? getExchangeRatesForCurrencies(exchangeRates, quote.name, base.name)
							: getExchangeRatesForCurrencies(exchangeRates, base.name, quote.name),
					amount: formatCurrency(baseAmount),
					priceUSD:
						base.name === SYNTHS_MAP.sUSD
							? getExchangeRatesForCurrencies(exchangeRates, quote.name, SYNTHS_MAP.sUSD)
							: getExchangeRatesForCurrencies(exchangeRates, base.name, SYNTHS_MAP.sUSD),
					totalUSD: formatCurrency(
						Number(baseAmount) *
							getExchangeRatesForCurrencies(exchangeRates, base.name, SYNTHS_MAP.sUSD)
					),
					status: TRANSACTION_STATUS.WAITING,
				});

				const tx = await Synthetix.exchange(
					bytesFormatter(quote.name),
					amountToExchange,
					bytesFormatter(base.name),
					{
						gasPrice: gasInfo.gasPrice * GWEI_UNIT,
						gasLimit: rectifiedGasLimit,
					}
				);

				updateTransaction({ status: TRANSACTION_STATUS.PENDING, ...tx }, transactionId);
			} else {
				console.log(
					bytesFormatter(quote.name),
					quoteAmount.toString(),
					bytesFormatter(base.name),
					quoteAmount.toString(),
					'1',
					{
						value: '1',
					}
				);
				// add typings
				/*
					{
							newOrder: (
								sourceCurrencyKey: string,
								sourceAmount: string,
								destinationCurrencyKey: string,
								minDestinationAmount: string,
								executionFee: string,
								gas: { value: string }
							) => Promise<ethers.ContractTransaction>;
						}
				*/
				const tx = await limitOrdersContractWithSigner.newOrder(
					bytesFormatter(quote.name),
					amountToExchange,
					bytesFormatter(base.name),
					limitPrice,
					bigNumberify(1),
					{
						value: bigNumberify(1),
						gasPrice: gasInfo.gasPrice * GWEI_UNIT,
						gasLimit: 500000,
					}
				);
				console.log(tx);
			}
			setIsSubmitting(false);
		} catch (e) {
			console.log(e);
			const error = errorMessages(e, walletType);
			updateTransaction(
				{
					status:
						error.type === 'cancelled' ? TRANSACTION_STATUS.CANCELLED : TRANSACTION_STATUS.FAILED,
					error: error.message,
				},
				transactionId
			);
			setTxErrorMessage(t('common.errors.unknown-error-try-again'));
			setIsSubmitting(false);
		}
	};

	return (
		<Card>
			<StyledCardHeader>
				<TabButton isActive={isMarketOrder} onClick={() => setOrderType('market')}>
					{t('trade.trade-card.tabs.market')}
				</TabButton>
				<TabButton isActive={isLimitOrder} onClick={() => setOrderType('limit')}>
					{t('trade.trade-card.tabs.limit')}
				</TabButton>
			</StyledCardHeader>
			<StyledCardBody isLimitOrder={isLimitOrder}>
				<FormInputRow>
					<StyledNumericInputWithCurrency
						currencyKey={quote.name}
						value={`${quoteAmount}`}
						label={
							<>
								<FormInputLabel>{t('trade.trade-card.sell-input-label')}:</FormInputLabel>
								<StyledFormInputLabelSmall
									isInteractive={!isEmptyQuoteBalance}
									onClick={setMaxBalance}
								>
									{t('common.wallet.balance-currency', {
										balance: quoteBalance
											? formatCurrency(quoteBalance.balance)
											: !isEmpty(synthsWalletBalances)
											? 0
											: EMPTY_VALUE,
									})}
								</StyledFormInputLabelSmall>
							</>
						}
						onChange={(_, value) => {
							setTradeAllBalance(false);
							setBaseAmount(`${Number(value) * rate}`);
							setQuoteAmount(value);
						}}
						errorMessage={inputError}
					/>
				</FormInputRow>
				{isMarketOrder && (
					<BalanceFractionRow>
						<Button palette="secondary" size="xs" onClick={handleSwapCurrencies}>
							<ReverseArrow />
						</Button>
						{BALANCE_FRACTIONS.map((fraction, id) => (
							<Button
								palette="secondary"
								size="xs"
								disabled={isEmptyQuoteBalance}
								key={`button-fraction-${id}`}
								onClick={() => {
									const balance = quoteBalance.balance;
									const isWholeBalance = fraction === 100;
									const amount = isWholeBalance ? balance : (balance * fraction) / 100;
									setTradeAllBalance(isWholeBalance);
									setQuoteAmount(amount);
									setBaseAmount(`${Number(amount) * Number(rate)}`);
								}}
							>
								{fraction}%
							</Button>
						))}
					</BalanceFractionRow>
				)}
				<FormInputRow>
					<StyledNumericInputWithCurrency
						currencyKey={base.name}
						value={`${baseAmount}`}
						label={
							<>
								<FlexDivCentered>
									<FormInputLabel>{t('trade.trade-card.buy-input-label')}:</FormInputLabel>
									<ReverseArrowButton onClick={handleSwapCurrencies}>
										<ReverseArrow />
									</ReverseArrowButton>
								</FlexDivCentered>
								<StyledFormInputLabelSmall
									isInteractive={!isEmptyQuoteBalance}
									onClick={setMaxBalance}
								>
									{t('common.wallet.balance-currency', {
										balance: baseBalance
											? formatCurrency(baseBalance.balance)
											: !isEmpty(synthsWalletBalances)
											? 0
											: EMPTY_VALUE,
									})}
								</StyledFormInputLabelSmall>
							</>
						}
						onChange={(_, value) => {
							setTradeAllBalance(false);
							setQuoteAmount(`${Number(value) * inverseRate}`);
							setBaseAmount(value);
						}}
					/>
				</FormInputRow>
				{isLimitOrder && (
					<>
						<FormInputRow>
							<StyledNumericInputWithCurrency
								currencyKey={base.name}
								value={`${limitPrice}`}
								label={<FormInputLabel>{t('common.price-label')}</FormInputLabel>}
								onChange={(_, value) => {
									setLimitPrice(value);
								}}
							/>
						</FormInputRow>
					</>
				)}
				<NetworkInfoContainer>
					<NetworkInfo
						gasPrice={gasInfo.gasPrice}
						gasLimit={gasLimit}
						ethRate={ethRate}
						exchangeFeeRate={feeRate}
						onEditButtonClick={showGweiPopup}
						amount={Number(baseAmount)}
						usdRate={getExchangeRatesForCurrencies(exchangeRates, base.name, SYNTHS_MAP.sUSD)}
					/>
				</NetworkInfoContainer>

				{hasMarketClosed ? (
					<ActionButton disabled={true}>
						{t('common.systemStatus.suspended-synths.reasons.market-closed')}
					</ActionButton>
				) : feeReclamationError ? (
					<ActionButton onClick={() => getMaxSecsLeftInWaitingPeriod()}>
						{t('trade.trade-card.retry-button')}
					</ActionButton>
				) : synthsMap[base.name].isFrozen ? (
					<ActionButton disabled={true}>{t('trade.trade-card.frozen-synth')}</ActionButton>
				) : (
					<ActionButton disabled={buttonDisabled} onClick={handleSubmit}>
						{t('trade.trade-card.confirm-trade-button')}
					</ActionButton>
				)}
				{txErrorMessage && (
					<TxErrorMessage
						onDismiss={() => setTxErrorMessage(null)}
						type="error"
						size="sm"
						floating={true}
					>
						{txErrorMessage}
					</TxErrorMessage>
				)}
				{feeReclamationError && (
					<TxErrorMessage
						onDismiss={() => setFeeReclamationError(null)}
						type="error"
						size="sm"
						floating={true}
					>
						{feeReclamationError}
					</TxErrorMessage>
				)}
			</StyledCardBody>
		</Card>
	);
};

const ActionButton = styled(Button).attrs({
	size: 'md',
	palette: 'primary',
})`
	width: 100%;
`;

const StyledCardHeader = styled(Card.Header)`
	padding: 0;
	> * + * {
		margin-left: 0;
	}
	display: grid;
	grid-template-columns: 1fr 1fr;
	padding: 4px;
	grid-gap: 4px;
`;

const NetworkInfoContainer = styled.div`
	padding-bottom: 20px;
`;

const StyledCardBody = styled(Card.Body)<{ isLimitOrder: boolean }>`
	padding: 12px 12px 16px 12px;
	${(props) =>
		props.isLimitOrder &&
		`
			${FormInputRow} {
				margin-bottom: 10px;
			}
			${NetworkInfoContainer} {
				padding-bottom: 0;
			}
		`}
`;

const StyledNumericInputWithCurrency = styled(NumericInputWithCurrency)`
	.input {
		height: ${INPUT_SIZES.sm};
	}
`;

export const TabButton = styled(Button).attrs({ size: 'sm', palette: 'tab' })``;

const BalanceFractionRow = styled.div`
	display: grid;
	grid-column-gap: 8px;
	grid-auto-flow: column;
	margin-bottom: 16px;
`;

const StyledFormInputLabelSmall = styled(FormInputLabelSmall)<{ isInteractive: boolean }>`
	cursor: ${(props) => (props.isInteractive ? 'pointer' : 'default')};
`;

export const TxErrorMessage = styled(DismissableMessage)`
	margin-top: 8px;
`;

const ReverseArrowButton = styled.button`
	${resetButtonCSS};
	color: ${(props) => props.theme.colors.buttonHover};
	padding-left: 49px;
	svg {
		width: 12px;
	}
`;

export default connector(CreateOrderCard);
