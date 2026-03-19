import { useState, useCallback, useEffect } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { useConnect } from '@stacks/connect-react';
import { AppConfig, UserSession, showContractCall } from '@stacks/connect';
import {
  uintCV,
  stringAsciiCV,
  PostConditionMode,
} from '@stacks/transactions';
import { STACKS_TESTNET } from '@stacks/network';
import * as anchor from '@coral-xyz/anchor';
import { PublicKey, SystemProgram, Keypair } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import axios from 'axios';
import idl from './idl.json';
import heroImg from './assets/hero.png';

const appConfig = new AppConfig(['store_write', 'publish_data']);
const userSession = new UserSession({ appConfig });

const STACKS_VAULT_ADDRESS = 'ST1JAVX7CNPPF0T55QVEEYNYMM55ZMM0FM16EQBV7';
const STACKS_VAULT_NAME = 'vault';
const SOLANA_PROGRAM_ID = '2L7y7D1omkfc7y5diJ3e9a9y4mNJBk8BcZxYEcJeLM68';
const SSOL_MINT_ADDRESS = '8ffmj57QkSMpquZ4b4YH4af7Jn3CZptktrAwiyKc3D4n';

const STACKS_LOGO_URL = 'https://assets.coingecko.com/coins/images/2069/large/Stacks_logo_full.png';
const SOLANA_LOGO_URL = 'https://assets.coingecko.com/coins/images/4128/large/solana.png';
const RELAYER_API = import.meta.env.VITE_RELAYER_API;

const STACKS_LOGO = <img src={STACKS_LOGO_URL} alt="Stacks" className="w-8 h-8 outline outline-1 outline-white/10 rounded-full bg-white/10 shadow-lg" />;
const SOLANA_LOGO = <img src={SOLANA_LOGO_URL} alt="Solana" className="w-8 h-8 outline outline-1 outline-white/10 rounded-full bg-white/10 shadow-lg" />;


function App() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { publicKey: solanaAddress } = wallet;
  const { authenticate } = useConnect();

  const [amount, setAmount] = useState<string>('');
  const [direction, setDirection] = useState<'STX_TO_SSOL' | 'SSOL_TO_STX'>('STX_TO_SSOL');
  const [status, setStatus] = useState<{ type: 'info' | 'success' | 'error', msg: string } | null>(null);
  const [showAdmin, setShowAdmin] = useState(false);
  const [relayerSolAddress, setRelayerSolAddress] = useState('');
  const [vaultBalance, setVaultBalance] = useState<string | null>(null);
  const [activeTransaction, setActiveTransaction] = useState<any | null>(null);
  const [view, setView] = useState<'bridge' | 'portfolio'>('bridge');
  const [portfolioHistory, setPortfolioHistory] = useState<any[]>([]);
  const [userStacksBalance, setUserStacksBalance] = useState<string | null>(null);
  const [userSolanaBalance, setUserSolanaBalance] = useState<string | null>(null);

  const isStacksConnected = userSession.isUserSignedIn();
  const stacksAddress = isStacksConnected ? userSession.loadUserData().profile.stxAddress.testnet : null;

  const fetchVaultBalance = useCallback(async () => {
    try {
      const res = await axios.get(`https://api.testnet.hiro.so/extended/v1/address/${STACKS_VAULT_ADDRESS}.${STACKS_VAULT_NAME}/balances`);
      const balance = res.data.stx.balance;
      setVaultBalance((Number(balance) / 1_000_000).toLocaleString());
    } catch (err) {
      console.error('Failed to fetch vault balance', err);
    }
  }, []);

  const fetchUserBalances = useCallback(async () => {
    if (stacksAddress) {
      try {
        const res = await axios.get(`https://api.testnet.hiro.so/extended/v1/address/${stacksAddress}/balances`);
        const balance = res.data.stx.balance;
        setUserStacksBalance((Number(balance) / 1_000_000).toLocaleString());
      } catch (err) {
        console.error('Failed to fetch user Stacks balance', err);
      }
    }

    if (solanaAddress) {
      try {
        const ssolMintPubkey = new PublicKey(SSOL_MINT_ADDRESS);
        const userAta = getAssociatedTokenAddressSync(ssolMintPubkey, solanaAddress);
        const balance = await connection.getTokenAccountBalance(userAta);
        setUserSolanaBalance(balance.value.uiAmountString || "0");
      } catch (err) {
        setUserSolanaBalance("0");
      }
    }
  }, [stacksAddress, solanaAddress, connection]);

  const fetchTransactionHistory = useCallback(async () => {
    if (!stacksAddress) return;
    try {
      const res = await axios.get(`https://api.testnet.hiro.so/extended/v1/address/${stacksAddress}/transactions?limit=20`);
      const bridgeTxs = res.data.results
        .filter((tx: any) =>
          tx.tx_type === 'contract_call' &&
          tx.contract_call.contract_id === `${STACKS_VAULT_ADDRESS}.${STACKS_VAULT_NAME}`
        )
        .map((tx: any) => ({
          id: tx.tx_id.slice(0, 10) + '...',
          date: new Date(tx.burn_block_time_iso || Date.now()).toISOString().split('T')[0],
          type: tx.contract_call.function_name === 'deposit' ? 'Deposit' : 'Release',
          amount: (Number(tx.contract_call.function_args?.[0]?.repr?.replace('u', '') || 0) / 1_000_000).toLocaleString(),
          token: tx.contract_call.function_name === 'deposit' ? 'STX' : 'sSOL',
          status: tx.tx_status === 'success' ? 'Confirmed' : 'Pending'
        }));
      setPortfolioHistory(bridgeTxs);
    } catch (err) {
      console.error('Failed to fetch transaction history', err);
    }
  }, [stacksAddress]);

  useEffect(() => {
    fetchVaultBalance();
    fetchUserBalances();
    fetchTransactionHistory();
    const interval = setInterval(() => {
      fetchVaultBalance();
      fetchUserBalances();
      fetchTransactionHistory();
    }, 15000);
    return () => clearInterval(interval);
  }, [fetchVaultBalance, fetchUserBalances, fetchTransactionHistory]);

  // Poll relayer for active transaction status
  useEffect(() => {
    if (!activeTransaction || activeTransaction.status === 'Confirmed') return;

    const pollInterval = setInterval(async () => {
      try {
        const res = await axios.get(`${RELAYER_API}/status/${activeTransaction.id}`);
        if (res.data.status === 'Confirmed') {
          setActiveTransaction((prev: any) => prev ? { ...prev, status: 'Confirmed', step: 2 } : null);
          clearInterval(pollInterval);
        }
      } catch (err) {
        console.error('Relayer poll failed', err);
      }
    }, 5000);

    return () => clearInterval(pollInterval);
  }, [activeTransaction]);

  const fromChain = direction === 'STX_TO_SSOL' ? 'Stacks' : 'Solana';
  const toChain = direction === 'STX_TO_SSOL' ? 'Solana' : 'Stacks';
  const fromToken = direction === 'STX_TO_SSOL' ? 'STX' : 'sSOL';
  const toToken = direction === 'STX_TO_SSOL' ? 'sSOL' : 'STX';
  const fromLogo = direction === 'STX_TO_SSOL' ? STACKS_LOGO : SOLANA_LOGO;
  const toLogo = direction === 'STX_TO_SSOL' ? SOLANA_LOGO : STACKS_LOGO;

  const handleStacksConnect = useCallback(() => {
    authenticate({
      appDetails: {
        name: 'Aura Bridge',
        icon: window.location.origin + '/logo.png',
      },
      onFinish: () => {
        window.location.reload();
      },
    });
  }, [authenticate]);

  const handleInitialize = async () => {
    if (!solanaAddress || !relayerSolAddress) {
      setStatus({ type: 'error', msg: 'Connect Solana wallet and enter Relayer Address' });
      return;
    }

    try {
      setStatus({ type: 'info', msg: 'Step 1/2: Initializing sSOL Mint...' });

      const provider = new anchor.AnchorProvider(
        connection,
        wallet as any,
        { preflightCommitment: 'confirmed' }
      );
      const programId = new PublicKey(SOLANA_PROGRAM_ID);
      const program = new anchor.Program(idl as any, programId, provider);

      const mintKeypair = Keypair.generate();
      const [bridgeStatePda] = PublicKey.findProgramAddressSync(
        [Buffer.from('bridge-state')],
        programId
      );

      const tx1 = await program.methods
        .initializeMint()
        .accounts({
          ssolMint: mintKeypair.publicKey,
          mintAuthority: new PublicKey(relayerSolAddress),
          payer: solanaAddress,
          systemProgram: SystemProgram.programId,
          tokenProgram: (anchor.utils as any).token.TOKEN_PROGRAM_ID || TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        } as any)
        .transaction();

      tx1.feePayer = solanaAddress;
      tx1.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      const sig1 = await wallet.sendTransaction(tx1, connection, { signers: [mintKeypair] });
      await connection.confirmTransaction(sig1, 'confirmed');

      setStatus({ type: 'info', msg: 'Step 2/2: Initializing Bridge State...' });

      const tx2 = await program.methods
        .initializeBridge()
        .accounts({
          bridgeState: bridgeStatePda,
          payer: solanaAddress,
          systemProgram: SystemProgram.programId,
        } as any)
        .transaction();

      tx2.feePayer = solanaAddress;
      tx2.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      const sig2 = await wallet.sendTransaction(tx2, connection);
      await connection.confirmTransaction(sig2, 'confirmed');

      setStatus({
        type: 'success',
        msg: `Done! SSOL_MINT=${mintKeypair.publicKey.toBase58()} — copy this to relayer .env as SSOL_MINT_ADDRESS`
      });
    } catch (err: any) {
      setStatus({ type: 'error', msg: `Initialization failed: ${err.message}` });
    }
  };

  const handleBridge = async () => {
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      setStatus({ type: 'error', msg: 'Please enter a valid amount' });
      return;
    }

    if (direction === 'STX_TO_SSOL') {
      if (!isStacksConnected || !solanaAddress) {
        setStatus({ type: 'error', msg: 'Connect both wallets first' });
        return;
      }

      const amountUstx = Math.floor(Number(amount) * 1_000_000);
      const nonce = `bridge-${Date.now()}`;

      setStatus({ type: 'info', msg: 'Initiating Stacks deposit...' });

      showContractCall({
        network: STACKS_TESTNET,
        contractAddress: STACKS_VAULT_ADDRESS,
        contractName: STACKS_VAULT_NAME,
        functionName: 'deposit',
        functionArgs: [
          uintCV(amountUstx),
          stringAsciiCV(solanaAddress.toBase58()),
          stringAsciiCV(nonce)
        ],
        postConditionMode: PostConditionMode.Allow,
        onFinish: (data) => {
          setStatus({ type: 'success', msg: `Deposit broadcasted! TXID: ${data.txId.slice(0, 10)}...` });
          setActiveTransaction({
            id: data.txId,
            from: 'Stacks',
            to: 'Solana',
            amount: amount,
            token: 'STX',
            status: 'Processing',
            step: 1
          });
        },
        onCancel: () => {
          setStatus({ type: 'error', msg: 'Deposit cancelled' });
        }
      });

    } else {
      // SSOL_TO_STX: burn sSOL on Solana, relayer releases STX on Stacks
      if (!solanaAddress || !isStacksConnected) {
        setStatus({ type: 'error', msg: 'Connect both wallets first' });
        return;
      }

      try {
        setStatus({ type: 'info', msg: 'Building burn transaction...' });

        const provider = new anchor.AnchorProvider(
          connection,
          wallet as any,
          { preflightCommitment: 'confirmed' }
        );
        const programId = new PublicKey(SOLANA_PROGRAM_ID);
        const program = new anchor.Program(idl as any, programId, provider);

        const ssolMintPubkey = new PublicKey(SSOL_MINT_ADDRESS);
        const userAta = getAssociatedTokenAddressSync(ssolMintPubkey, solanaAddress);

        const amountLamports = Math.floor(Number(amount) * 1_000_000);
        const nonce = `burn-${Date.now()}`;

        const tx = await program.methods
          .burnSsol(
            new anchor.BN(amountLamports),
            stacksAddress!,
            nonce
          )
          .accounts({
            ssolMint: ssolMintPubkey,
            userAta,
            user: solanaAddress,
            tokenProgram: TOKEN_PROGRAM_ID,
          } as any)
          .transaction();

        tx.feePayer = solanaAddress;
        tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

        setStatus({ type: 'info', msg: 'Waiting for wallet approval...' });
        const sig = await wallet.sendTransaction(tx, connection);
        await connection.confirmTransaction(sig, 'confirmed');

        setStatus({
          type: 'success',
          msg: `sSOL burned! Sig: ${sig.slice(0, 10)}... — relayer will release STX shortly.`
        });
        setActiveTransaction({
          id: sig,
          from: 'Solana',
          to: 'Stacks',
          amount: amount,
          token: 'sSOL',
          status: 'Processing',
          step: 1
        });
      } catch (err: any) {
        setStatus({ type: 'error', msg: `Burn failed: ${err.message}` });
      }
    }
  };

  const handleSwapDirection = () => {
    setDirection(d => d === 'STX_TO_SSOL' ? 'SSOL_TO_STX' : 'STX_TO_SSOL');
    setStatus(null);
    setAmount('');
  };

  const bridgeDisabled = !amount || Number(amount) <= 0 ||
    (direction === 'STX_TO_SSOL' && (!isStacksConnected || !solanaAddress)) ||
    (direction === 'SSOL_TO_STX' && (!solanaAddress || !isStacksConnected));

  const renderPortfolio = () => (
    <div className="space-y-12 animate-in fade-in duration-700">
      {/* Balance Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="bg-card-bg/40 border border-white/10 p-8 shadow-2xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-20 transition-opacity">
            {STACKS_LOGO}
          </div>
          <h2 className="text-[10px] font-black uppercase tracking-[0.4em] text-gray-700 mb-4">Stacks_Wallet</h2>
          <div className="flex items-baseline gap-3">
            <span className="text-4xl font-black text-white tracking-tighter">{userStacksBalance || "---"}</span>
            <span className="text-xs font-black text-stacks tracking-widest uppercase">STX</span>
          </div>
          <div className="mt-4 text-[9px] text-gray-600 font-mono tracking-widest">
            {stacksAddress ? `${stacksAddress.slice(0, 6)}...${stacksAddress.slice(-6)}` : 'DISCONNECTED'}
          </div>
        </div>

        <div className="bg-card-bg/40 border border-white/10 p-8 shadow-2xl relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-20 transition-opacity">
            {SOLANA_LOGO}
          </div>
          <h2 className="text-[10px] font-black uppercase tracking-[0.4em] text-gray-700 mb-4">Solana_Wallet</h2>
          <div className="flex items-baseline gap-3">
            <span className="text-4xl font-black text-white tracking-tighter">{userSolanaBalance || "---"}</span>
            <span className="text-xs font-black text-solana tracking-widest uppercase">sSOL</span>
          </div>
          <div className="mt-4 text-[9px] text-gray-600 font-mono tracking-widest">
            {solanaAddress ? `${solanaAddress.toBase58().slice(0, 6)}...${solanaAddress.toBase58().slice(-6)}` : 'DISCONNECTED'}
          </div>
        </div>
      </div>

      {/* Liquidity Chart Section */}
      <div className="bg-card-bg/40 border border-white/10 p-8 shadow-2xl">
        <div className="flex justify-between items-center mb-12">
          <h2 className="text-[10px] font-black uppercase tracking-[0.4em] text-gray-700">Protocol_Liquidity_Flow</h2>
          <div className="flex gap-8">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-accent rounded-full" />
              <span className="text-[9px] font-black uppercase tracking-widest text-gray-500">STX_Locked</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-solana rounded-full" />
              <span className="text-[9px] font-black uppercase tracking-widest text-gray-500">sSOL_Circulating</span>
            </div>
          </div>
        </div>

        <div className="relative h-48 w-full">
          <svg className="w-full h-full" preserveAspectRatio="none">
            <defs>
              <linearGradient id="grad-accent" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#7c5cfc" stopOpacity="0.2" />
                <stop offset="100%" stopColor="#7c5cfc" stopOpacity="0" />
              </linearGradient>
            </defs>
            {/* Chart Grid */}
            {[0, 1, 2, 3].map(i => (
              <line key={i} x1="0" y1={i * 60} x2="100%" y2={i * 60} stroke="white" strokeOpacity="0.03" strokeWidth="1" />
            ))}

            {/* STX Line */}
            <path
              d="M0 120 Q 200 80, 400 100 T 800 60 T 1200 90"
              fill="none"
              stroke="#7c5cfc"
              strokeWidth="2"
              className="drop-shadow-[0_0_8px_rgba(124,92,252,0.5)]"
            />
            <path
              d="M0 120 Q 200 80, 400 100 T 800 60 T 1200 90 L 1200 180 L 0 180 Z"
              fill="url(#grad-accent)"
            />

            {/* sSOL Line */}
            <path
              d="M0 140 Q 300 100, 600 120 T 1200 80"
              fill="none"
              stroke="#14f195"
              strokeWidth="2"
              className="drop-shadow-[0_0_8px_rgba(20,241,149,0.5)]"
            />
          </svg>
        </div>
      </div>

      {/* Transaction History Section */}
      <div className="bg-card-bg/40 border border-white/10 shadow-2xl overflow-hidden">
        <div className="p-6 border-b border-white/5 flex justify-between items-center">
          <h2 className="text-[10px] font-black uppercase tracking-[0.4em] text-gray-700">Bridge_Transaction_History</h2>
          <button className="text-[9px] font-black uppercase tracking-widest text-accent hover:text-white transition-colors">Export_CSV</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-white/[0.02]">
                <th className="p-6 text-[9px] font-black uppercase tracking-widest text-gray-600">ID</th>
                <th className="p-6 text-[9px] font-black uppercase tracking-widest text-gray-600">Date</th>
                <th className="p-6 text-[9px] font-black uppercase tracking-widest text-gray-600">Action</th>
                <th className="p-6 text-[9px] font-black uppercase tracking-widest text-gray-600">Amount</th>
                <th className="p-6 text-[9px] font-black uppercase tracking-widest text-gray-600">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {portfolioHistory.length > 0 ? (
                portfolioHistory.map(tx => (
                  <tr key={tx.id} className="hover:bg-white/[0.01] transition-colors">
                    <td className="p-6 font-mono text-[10px] text-gray-400">{tx.id}</td>
                    <td className="p-6 text-[10px] text-gray-500">{tx.date}</td>
                    <td className="p-6">
                      <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-none border ${tx.type === 'Deposit' ? 'border-accent/30 text-accent bg-accent/5' : 'border-solana/30 text-solana bg-solana/5'}`}>
                        {tx.type}
                      </span>
                    </td>
                    <td className="p-6 text-[10px] font-bold text-white tracking-wider">{tx.amount} {tx.token}</td>
                    <td className="p-6">
                      <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-solana">
                        <div className="w-1 h-1 bg-solana rounded-full shadow-[0_0_5px_rgba(20,241,149,0.5)]" />
                        {tx.status}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="p-12 text-center text-gray-700 uppercase font-black tracking-[0.2em] text-[10px]">
                    No Bridge Activity Found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="p-6 bg-white/[0.01] text-center">
          <button className="text-[9px] font-black uppercase tracking-widest text-gray-700 hover:text-white transition-colors">Load_More_Entries</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-bg-dark text-gray-400 font-sans selection:bg-accent/30 overflow-x-hidden">
      {/* Navbar - Truly Full Width (100vw) */}
      <nav className="w-full border-b border-white/5 bg-black/40 backdrop-blur-md sticky top-0 z-[100]">
        <div className="w-full px-12 py-5 flex justify-between items-center relative">
          <div className="flex items-center gap-3">
            <img src={heroImg} className="w-8 h-8 opacity-80" alt="Aura" />
            <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-white/50">Aura</span>
          </div>

          <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-8">
            <button
              onClick={() => setView('bridge')}
              className={`text-[11px] font-bold uppercase tracking-[0.2em] transition-colors ${view === 'bridge' ? 'text-white border-b border-accent pb-1' : 'text-gray-600 hover:text-white'}`}
            >
              Bridge
            </button>
            <button
              onClick={() => setView('portfolio')}
              className={`text-[11px] font-bold uppercase tracking-[0.2em] transition-colors ${view === 'portfolio' ? 'text-white border-b border-accent pb-1' : 'text-gray-600 hover:text-white'}`}
            >
              Portfolio
            </button>
            <a href="#" className="text-[11px] font-bold uppercase tracking-[0.2em] text-gray-600 hover:text-white transition-colors">Ecosystem</a>
          </div>

          <div className="flex items-center gap-6">
            <button className="text-gray-600 hover:text-white transition-colors p-2 hover:bg-white/5 rounded-none">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
            <button
              onClick={() => setShowAdmin(!showAdmin)}
              className="text-gray-600 hover:text-white transition-colors p-2 hover:bg-white/5 rounded-none"
              title="Admin"
            >
              <svg className="w-4 h-4 wheel-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>
        </div>
      </nav>

      {/* Terminal Frame Wrapper (Centered Content) */}
      <div className="flex-1 w-full max-w-[1126px] mx-auto border-x border-white/10 min-h-screen flex flex-col bg-black/5">
        <div className="px-8 pt-12 pb-20 flex-1">
          {/* Hero Title Section */}
          <div className="text-center mb-16">
            <h1 className="text-6xl font-black bg-gradient-to-r from-accent via-white to-solana bg-clip-text text-transparent tracking-tighter mb-4 animate-in fade-in slide-in-from-bottom-2 duration-1000">
              Universal Bridge
            </h1>
            <p className="text-[10px] uppercase font-black tracking-[0.6em] text-gray-700">
              Aura Network Liquidity Highway
            </p>
          </div>

          {view === 'bridge' ? (
            showAdmin ? (
              <div className="bg-black/40 border-y border-red-900/40 p-10 mb-12">
                <h3 className="text-red-500 uppercase tracking-widest text-xs font-black mb-8 flex items-center gap-2">
                  <span className="w-2.4 h-2.4 bg-red-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.5)]" />
                  DANGER: ADMIN_CONSOLE initialization
                </h3>
                <div className="space-y-6 max-w-md">
                  <div className="flex flex-col gap-2">
                    <label className="text-[9px] text-gray-700 uppercase font-black tracking-widest">Relayer Solana Pubkey</label>
                    <input
                      type="text"
                      placeholder="ENTER SOLANA ADDRESS"
                      value={relayerSolAddress}
                      onChange={(e) => setRelayerSolAddress(e.target.value)}
                      className="bg-white/5 border border-white/10 p-4 font-mono text-sm text-white outline-none focus:border-red-500/50 transition-all placeholder:text-gray-900"
                    />
                  </div>
                  <button
                    className="w-full bg-red-600/20 hover:bg-red-600 border border-red-500/40 text-red-500 hover:text-white font-black py-4 transition-all uppercase tracking-widest text-[10px]"
                    onClick={handleInitialize}
                  >
                    Confirm Global State Init
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start mb-32">

                {/* Bridge Main Panel - Nano Card (7/12) */}
                <div className="lg:col-span-7 bg-card-bg border border-white/10 p-6 space-y-4 shadow-2xl relative overflow-hidden group">
                  <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-accent/30 to-transparent" />

                  <div className="flex flex-wrap gap-3">
                    <div className="flex-1 min-w-[160px] h-10 bg-white/[0.04] border border-white/5 flex items-center px-4">
                      {isStacksConnected ? (
                        <div className="flex items-center justify-between w-full">
                          <span className="text-[8px] uppercase tracking-widest text-gray-700 font-black">STX</span>
                          <span className="text-[10px] font-mono text-accent">
                            {stacksAddress ? `${stacksAddress.slice(0, 4)}...${stacksAddress.slice(-4)}` : ''}
                          </span>
                        </div>
                      ) : (
                        <button onClick={handleStacksConnect} className="text-[10px] font-black uppercase tracking-widest text-white/50 hover:text-accent transition-colors w-full text-left">
                          Connect Stacks
                        </button>
                      )}
                    </div>
                    <div className="flex-1 min-w-[160px]">
                      <WalletMultiButton className="!h-10 !bg-white/[0.04] !border !border-white/5 !rounded-none !w-full !text-[10px] !font-black !uppercase !tracking-widest !transition-all hover:!bg-white/10" />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="bg-white/[0.01] border border-white/5 p-5 space-y-3 focus-within:border-accent/40 transition-all">
                      <div className="flex justify-between items-center">
                        <span className="text-[9px] uppercase font-black tracking-widest text-gray-700">Source_Transfer</span>
                        <div className="flex items-center gap-2 px-2 py-0.5 border border-white/5 bg-white/5">
                          {fromLogo && <div className="scale-75">{fromLogo}</div>}
                          <span className="text-[9px] font-black uppercase tracking-tighter text-gray-400">{fromChain}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <input
                          type="number"
                          placeholder="0.00"
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                          className="bg-transparent border-none outline-none text-3xl font-black text-white w-full placeholder:text-gray-900 tracking-tighter"
                        />
                        <div className="text-[10px] font-black text-gray-500 tracking-[0.2em] whitespace-nowrap">{fromToken}</div>
                      </div>
                    </div>

                    <div className="flex justify-center -my-3.5 relative z-20">
                      <button
                        onClick={handleSwapDirection}
                        className="w-10 h-10 bg-[#12121c] border border-white/10 text-accent hover:rotate-180 hover:bg-accent hover:text-white transition-all duration-700 flex items-center justify-center shadow-2xl"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M7 16V4m0 0L3 8m4-4 4 4M17 8v12m0 0 4-4m-4 4-4-4" />
                        </svg>
                      </button>
                    </div>

                    <div className="bg-white/[0.02] border border-white/5 p-5 space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-[9px] uppercase font-black tracking-widest text-gray-700">Destination_Mint_EST</span>
                        <div className={`flex items-center gap-2 px-2 py-0.5 border border-white/5 bg-white/5`}>
                          {toLogo && <div className="scale-75">{toLogo}</div>}
                          <span className={`text-[9px] font-black uppercase tracking-tighter ${direction === 'STX_TO_SSOL' ? 'text-solana' : 'text-stacks'}`}>{toChain}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-3xl font-black text-white/30 truncate tracking-tighter w-full">
                          {amount && Number(amount) > 0 ? Number(amount).toFixed(6) : '0.000000'}
                        </div>
                        <div className="text-[10px] font-black text-gray-500 tracking-[0.2em] whitespace-nowrap">{toToken}</div>
                      </div>
                    </div>
                  </div>

                  <div className="min-h-[20px]">
                    {status && (
                      <div className={`py-3 px-4 border text-[9px] font-bold uppercase tracking-widest animate-in fade-in duration-300 ${status.type === 'success' ? 'bg-solana/5 border-solana/20 text-solana' :
                        status.type === 'error' ? 'bg-red-500/5 border-red-500/20 text-red-500' :
                          'bg-accent/5 border-accent/20 text-accent'
                        }`}>
                        {status.msg}
                      </div>
                    )}
                  </div>

                  <button
                    onClick={handleBridge}
                    disabled={bridgeDisabled}
                    className={`w-full py-5 font-black uppercase tracking-[0.4em] text-[10px] transition-all duration-500 disabled:opacity-20 disabled:grayscale shadow-2xl outline-none active:scale-[0.99] border border-white/5 ${direction === 'STX_TO_SSOL'
                      ? 'bg-gradient-to-r from-accent to-accent/80 hover:shadow-accent/20'
                      : 'bg-gradient-to-r from-solana/80 to-solana hover:shadow-solana/20'
                      } text-white`}
                  >
                    {direction === 'STX_TO_SSOL' ? 'Execute_STX_to_sSOL' : 'Execute_sSOL_to_STX'}
                  </button>
                </div>

                {/* Side Info Panel - 5/12 */}
                <div className="lg:col-span-5 space-y-4">
                  <div className="bg-card-bg/50 border border-white/10 p-8 relative group">
                    <div className="flex justify-between items-start mb-8">
                      <div>
                        <h2 className="text-[10px] font-black uppercase tracking-[0.4em] text-gray-700 mb-2">Protocol_Liquidity</h2>
                        <div className="flex items-baseline gap-3">
                          <span className="text-5xl font-black text-white tracking-tighter leading-none">{vaultBalance || "---"}</span>
                          <span className="text-xs font-black text-stacks tracking-widest">STX</span>
                        </div>
                      </div>
                      <div className="w-8 h-8 rounded-full border border-white/10 flex items-center justify-center">
                        <div className="w-1.5 h-1.5 bg-accent rounded-full animate-pulse" />
                      </div>
                    </div>

                    <div className="space-y-6">
                      <div className="p-4 border border-white/5 bg-white/[0.02]">
                        <p className="text-[9px] leading-relaxed text-gray-600 uppercase font-black tracking-widest">
                          Total collateral locked in Aura_Vault_Mainnet. Audited and secured by transparent proof of reserve.
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-px bg-white/5">
                        <div className="bg-bg-dark p-4">
                          <span className="text-[7px] uppercase font-black text-gray-800 block mb-1">Volume_24h</span>
                          <span className="text-lg font-black text-white tracking-tight">1.2M+</span>
                        </div>
                        <div className="bg-bg-dark p-4">
                          <span className="text-[7px] uppercase font-black text-gray-800 block mb-1">System_Health</span>
                          <span className="text-lg font-black text-solana tracking-tight flex items-center gap-2">
                            OK
                            <span className="w-2 h-2 bg-solana/20 rounded-full animate-ping" />
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-white/[0.01] border border-white/5 p-6 flex items-center justify-between">
                    <span className="text-[9px] font-black uppercase text-gray-800 tracking-widest">Relayer_Cluster_V1</span>
                    <div className="flex gap-1.5">
                      {[1, 2, 3, 4].map(i => (
                        <div key={i} className={`w-3 h-1 ${i < 4 ? 'bg-solana/40' : 'bg-solana animate-pulse'}`} />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )
          ) : (
            renderPortfolio()
          )}

          {/* TX Monitor Area - Preferred style with progress bar */}
          {activeTransaction && (
            <div className="mb-32 animate-in fade-in slide-in-from-top-4 duration-500">
              <div className="bg-card-bg/40 border border-white/10 py-5 px-8 shadow-2xl rounded-none relative overflow-hidden max-w-[1126px] mx-auto backdrop-blur-sm">
                <div className={`absolute top-0 left-0 h-[2px] transition-all duration-1000 ${activeTransaction.status === 'Confirmed' ? 'w-full bg-solana' : 'w-1/2 bg-accent animate-pulse'}`} />

                <div className="flex justify-between items-center mb-6">
                  <div className="flex items-center gap-4">
                    <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-white/90">TX Status</h3>
                    <div className="h-4 w-px bg-white/10" />
                    <p className="text-[9px] text-gray-700 font-mono tracking-wider truncate max-w-[250px]">{activeTransaction.id}</p>
                  </div>
                  <button onClick={() => setActiveTransaction(null)} className="text-gray-700 hover:text-white transition-colors">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" strokeWidth={2.5} /></svg>
                  </button>
                </div>

                <div className="flex items-center justify-between gap-8 mb-6 max-w-xl mx-auto">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 flex items-center justify-center border text-[10px] font-black ${activeTransaction.step >= 1 ? 'border-accent text-accent bg-accent/5' : 'border-white/5 text-gray-800'}`}>01</div>
                    <span className="text-[9px] uppercase tracking-widest font-bold text-gray-600">Deposit</span>
                  </div>
                  <div className="h-[1px] flex-1 bg-white/5 relative overflow-hidden">
                    {activeTransaction.step >= 1 && <div className="absolute inset-0 bg-gradient-to-r from-accent to-solana transition-all duration-1000 w-full" />}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 flex items-center justify-center border text-[10px] font-black ${activeTransaction.step >= 2 ? 'border-solana text-solana bg-solana/5' : 'border-white/5 text-gray-800'}`}>
                      {activeTransaction.status === 'Confirmed' ? <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" strokeWidth={3} /></svg> : "02"}
                    </div>
                    <span className="text-[9px] uppercase tracking-widest font-bold text-gray-600">Release</span>
                  </div>
                </div>

                <div className="flex justify-between items-center bg-white/[0.02] py-3 px-5 border border-white/5 max-w-xl mx-auto">
                  <div className="flex items-center gap-3">
                    <div className={`w-5 h-5 flex items-center justify-center text-[9px] font-black ${activeTransaction.from === 'Stacks' ? 'bg-stacks/20 text-stacks' : 'bg-solana/20 text-solana'}`}>{activeTransaction.from[0]}</div>
                    <span className="text-[10px] font-bold text-gray-400 tracking-[0.2em]">{activeTransaction.amount} {activeTransaction.token}</span>
                  </div>
                  <div className={`text-[9px] font-black uppercase tracking-[0.2em] ${activeTransaction.status === 'Confirmed' ? 'text-solana' : 'text-accent'}`}>{activeTransaction.status}</div>
                </div>
              </div>
            </div>
          )}

          {/* Protocols Section */}
          <section className="border-t border-white/5 pt-32 pb-40">
            <h2 className="text-center text-[10px] font-black uppercase tracking-[0.5em] text-gray-700 mb-24">Aura_Bridge_Architecture</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-16">
              {[
                { n: "01", t: "Atomic Deposit", d: "Funds are securely locked in a chain-native vault contract.", c: "accent" },
                { n: "02", t: "Relay Sync", d: "Decentralized relayers witness and confirm the state transition.", c: "solana" },
                { n: "03", t: "Proof Mint", d: "Destination chain mints mirrored assets with 1:1 backed ratio.", c: "accent" }
              ].map(step => (
                <div key={step.n} className="space-y-8 text-center group border border-white/5 p-10 hover:bg-white/[0.01] transition-all">
                  <div className={`w-20 h-20 bg-white/5 flex items-center justify-center mx-auto border border-white/10 group-hover:border-${step.c}/40 transition-all`}>
                    <span className={`text-2xl font-black text-${step.c}`}>{step.n}</span>
                  </div>
                  <div className="space-y-4">
                    <h3 className="text-white font-black uppercase tracking-widest text-[11px]">{step.t}</h3>
                    <p className="text-[10px] leading-relaxed text-gray-600 uppercase font-black tracking-widest leading-loose">{step.d}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default App;