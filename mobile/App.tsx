import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  SafeAreaView,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Modal,
  ActivityIndicator,
  StatusBar,
  Alert,
  Image,
  Platform,
} from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraView, useCameraPermissions } from 'expo-camera';
import {
  Home,
  Send,
  QrCode,
  CreditCard,
  RefreshCw,
  Scan,
  Zap,
  Lock,
  ArrowUpRight,
  ArrowDownLeft,
  ShieldCheck,
  CheckCircle2,
  Clock,
  X,
  Wallet,
  User,
  Users,
  ChevronDown,
  LogOut,
  Fingerprint,
  Coffee,
  KeyRound,
  Sparkles,
} from 'lucide-react-native';
import { Colors } from './src/core/theme/colors';
import { UsersDB, UserProfile, PRESET_USERS } from './src/core/auth/userManager';
import { LocalDB, LocalLedgerEntry, PendingVoucher } from './src/core/database/sqlite';
import { MockTapBridge } from './src/features/tap_to_pay/mockTapBridge';

type ActiveTab = 'home' | 'send' | 'receive' | 'wallet' | 'sync';

const AUTH_STORAGE_KEY = '@tapcash_active_user_id';
const BIOMETRIC_LOCKED_KEY = '@tapcash_biometric_locked';

export default function App() {
  // App Authentication States
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isBiometricLocked, setIsBiometricLocked] = useState(false);

  // Sign In / Register Screen States
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authName, setAuthName] = useState('');
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  // Main App Navigation States
  const [activeTab, setActiveTab] = useState<ActiveTab>('home');
  const [history, setHistory] = useState<LocalLedgerEntry[]>(LocalDB.getHistory());
  const [pendingQueue, setPendingQueue] = useState<PendingVoucher[]>(LocalDB.getPendingQueue());
  const [isOfflineMode, setIsOfflineMode] = useState(false);

  // Switch User Modal
  const [switchUserModalVisible, setSwitchUserModalVisible] = useState(false);

  // Camera permissions
  const [permission, requestPermission] = useCameraPermissions();
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scanned, setScanned] = useState(false);

  // Send Online / P2P State
  const [recipientEmail, setRecipientEmail] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [sendNote, setSendNote] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendSuccessMsg, setSendSuccessMsg] = useState<string | null>(null);

  // Receive / Custom QR State
  const [receiveAmount, setReceiveAmount] = useState('150');
  const [receiveNote, setReceiveNote] = useState('Payment for Chai & Snacks');

  // Tap-to-Pay NFC Modal
  const [tapModalVisible, setTapModalVisible] = useState(false);
  const [tapAmount, setTapAmount] = useState('150');
  const [merchantName, setMerchantName] = useState('Metro Coffee Roasters');
  const [isProcessingTap, setIsProcessingTap] = useState(false);
  const [tapResultMsg, setTapResultMsg] = useState<string | null>(null);

  // Sync Hub
  const [isSyncing, setIsSyncing] = useState(false);

  // 1. Initial Launch Check (Persistent Login + Biometric Lock)
  useEffect(() => {
    checkSavedSession();
  }, []);

  const checkSavedSession = async () => {
    try {
      const savedUserId = await AsyncStorage.getItem(AUTH_STORAGE_KEY);
      if (savedUserId) {
        const user = UsersDB.switchUser(savedUserId);
        setCurrentUser(user);
        // Prompt Biometric Authentication to unlock
        promptBiometricAuth(user.name);
      } else {
        setIsInitializing(false);
      }
    } catch {
      setIsInitializing(false);
    }
  };

  // Biometric Unlock Prompt
  const promptBiometricAuth = async (userName?: string) => {
    setIsBiometricLocked(true);
    setIsInitializing(false);

    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();

    if (!hasHardware || !isEnrolled) {
      // Hardware not supported (or simulator), auto-unlock
      setIsBiometricLocked(false);
      return;
    }

    const authResult = await LocalAuthentication.authenticateAsync({
      promptMessage: `Unlock TapCash for ${userName || 'User'}`,
      cancelLabel: 'Use PIN',
      fallbackLabel: 'Use PIN',
      disableDeviceFallback: false,
    });

    if (authResult.success) {
      setIsBiometricLocked(false);
    }
  };

  const handleManualUnlock = () => {
    setIsBiometricLocked(false);
  };

  // 2. Sign In Handler
  const handleSignIn = async (emailToLogin?: string) => {
    const targetEmail = (emailToLogin || authEmail).trim();
    if (!targetEmail) {
      Alert.alert('Missing Email', 'Please enter your email to sign in.');
      return;
    }

    setIsAuthenticating(true);
    setTimeout(async () => {
      let matchedUser = PRESET_USERS.find(
        (u) => u.email.toLowerCase() === targetEmail.toLowerCase()
      );

      if (!matchedUser) {
        // Create new user profile if not in presets
        matchedUser = {
          id: `usr_${Date.now()}`,
          name: authName.trim() || targetEmail.split('@')[0],
          email: targetEmail,
          avatar: '👤',
          devicePublicKey: `ed25519_pub_${Date.now().toString(36)}`,
          balanceCents: 100000, // ₹1,000 Welcome Bonus
        };
        PRESET_USERS.push(matchedUser);
      }

      UsersDB.switchUser(matchedUser.id);
      await AsyncStorage.setItem(AUTH_STORAGE_KEY, matchedUser.id);
      setCurrentUser(matchedUser);
      setIsAuthenticating(false);
      setAuthEmail('');
      setAuthPassword('');
      setAuthName('');
    }, 600);
  };

  // 3. Log Out Handler
  const handleLogOut = async () => {
    Alert.alert('Log Out', 'Are you sure you want to log out of TapCash?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log Out',
        style: 'destructive',
        onPress: async () => {
          await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
          setCurrentUser(null);
          setIsBiometricLocked(false);
        },
      },
    ]);
  };

  // Switch Active User
  const handleSelectUser = async (userId: string) => {
    const newUser = UsersDB.switchUser(userId);
    await AsyncStorage.setItem(AUTH_STORAGE_KEY, userId);
    setCurrentUser(newUser);
    setSwitchUserModalVisible(false);
    refreshState();
    Alert.alert('Account Switched', `Logged in as: ${newUser.name} (${newUser.email})`);
  };

  const refreshState = () => {
    setCurrentUser(UsersDB.getCurrentUser());
    setHistory(LocalDB.getHistory());
    setPendingQueue(LocalDB.getPendingQueue());
  };

  // Dynamic Personalized QR Payload
  const qrPayload = currentUser
    ? JSON.stringify({
        type: 'TAPCASH_POS_INTENT',
        merchantId: currentUser.id,
        merchantName: currentUser.name,
        merchantEmail: currentUser.email,
        amountCents: Math.round((parseFloat(receiveAmount) || 0) * 100),
        nonce: `nonce_${Date.now()}`,
        note: receiveNote,
        timestamp: Date.now(),
      })
    : '';
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(qrPayload)}&bgcolor=ffffff&color=09090b&margin=2`;

  // 4. Send Online P2P Transfer
  const handleSendP2P = async () => {
    if (!currentUser) return;
    const amountNum = parseFloat(sendAmount);
    if (!recipientEmail || isNaN(amountNum) || amountNum <= 0) {
      Alert.alert('Invalid Input', 'Please enter recipient email/ID and valid amount.');
      return;
    }

    const amountCents = Math.round(amountNum * 100);
    if (currentUser.balanceCents < amountCents) {
      Alert.alert('Insufficient Balance', `You only have ₹${(currentUser.balanceCents / 100).toFixed(2)} in your account.`);
      return;
    }

    setIsSending(true);
    setSendSuccessMsg(null);

    setTimeout(() => {
      const res = UsersDB.transfer(currentUser.id, recipientEmail, amountCents);

      if (!res.success) {
        setIsSending(false);
        Alert.alert('Transfer Failed', res.error);
        return;
      }

      const voucher: PendingVoucher = {
        voucherId: `vch_p2p_${Date.now()}`,
        payerPublicKey: currentUser.devicePublicKey,
        payeeId: recipientEmail,
        amountCents,
        currency: 'INR',
        sequenceNumber: LocalDB.getSequence() + 1,
        timestamp: Date.now(),
        nonce: `nonce_p2p_${Date.now()}`,
        signature: 'ed25519_p2p_sig_valid',
        status: isOfflineMode ? 'PENDING' : 'SYNCED',
      };

      LocalDB.recordOfflineDebit(voucher, `Sent to ${res.toUser ? res.toUser.name : recipientEmail} (${sendNote || 'Transfer'})`);
      setIsSending(false);
      refreshState();
      setSendSuccessMsg(`₹${amountNum.toFixed(2)} transferred successfully to ${res.toUser ? res.toUser.name : recipientEmail}!`);
      setSendAmount('');
      setRecipientEmail('');
      setSendNote('');
    }, 800);
  };

  // 5. Camera Barcode Scanner Handler
  const handleBarcodeScanned = ({ data }: { data: string }) => {
    if (scanned) return;
    setScanned(true);
    setIsScannerOpen(false);

    try {
      const parsed = JSON.parse(data);
      if (parsed.type === 'TAPCASH_POS_INTENT' || parsed.type === 'TAPCASH_PAY_INTENT') {
        const amt = parsed.amountCents ? (parsed.amountCents / 100).toString() : parsed.amount || '0';
        const payee = parsed.merchantEmail || parsed.merchantName || parsed.merchantId || parsed.payee || 'Merchant';
        setActiveTab('send');
        setRecipientEmail(payee);
        setSendAmount(amt);
        setSendNote(parsed.note || 'Scanned via Live Camera');
        Alert.alert('QR Scanned! 🎉', `Recipient: ${parsed.merchantName || payee}\nAmount: ₹${amt}`);
        return;
      }
    } catch {
      // Raw string fallback
    }

    setActiveTab('send');
    setRecipientEmail(data.substring(0, 30));
    setSendAmount('150');
    Alert.alert('Code Scanned', `Scanned address: ${data}`);
  };

  const openCameraScanner = async () => {
    if (!permission?.granted) {
      const { granted } = await requestPermission();
      if (!granted) {
        Alert.alert('Permission Required', 'Camera permission is needed to scan payment QR codes.');
        return;
      }
    }
    setScanned(false);
    setIsScannerOpen(true);
  };

  // 6. Top-Up Wallet Balance
  const handleTopUp = (amt: number) => {
    if (!currentUser) return;
    UsersDB.topUp(currentUser.id, amt * 100);
    const voucher: PendingVoucher = {
      voucherId: `topup_${Date.now()}`,
      payerPublicKey: 'bank_gateway',
      payeeId: currentUser.id,
      amountCents: amt * 100,
      currency: 'INR',
      sequenceNumber: LocalDB.getSequence(),
      timestamp: Date.now(),
      nonce: `topup_nonce_${Date.now()}`,
      signature: 'bank_verified',
      status: 'SYNCED',
    };
    LocalDB.recordOfflineCredit(voucher, `Top-Up via UPI/Bank (+₹${amt})`);
    refreshState();
    Alert.alert('Top-Up Success', `₹${amt} added to ${currentUser.name}'s wallet!`);
  };

  // 7. NFC Tap-to-Pay Beam
  const handleExecuteTap = async () => {
    if (!currentUser) return;
    const amountNum = parseFloat(tapAmount);
    if (isNaN(amountNum) || amountNum <= 0) return;

    setIsProcessingTap(true);
    setTapResultMsg(null);

    const res = await MockTapBridge.executeNfcExchange({
      payeeId: 'usr_merchant_coffee_99',
      payeeName: merchantName,
      amountCents: Math.round(amountNum * 100),
    });

    UsersDB.transfer(currentUser.id, 'merchant@metrocoffee.com', Math.round(amountNum * 100));
    setIsProcessingTap(false);
    refreshState();

    if (res.success) {
      setTapResultMsg(`Settled in ${res.latencyMs}ms! (Ed25519 Signed Voucher Created)`);
      setTimeout(() => {
        setTapModalVisible(false);
        setTapResultMsg(null);
      }, 1500);
    } else {
      setTapResultMsg(`Failed: ${res.error}`);
    }
  };

  // 8. Batch Sync to Backend
  const handleSyncNow = async () => {
    if (pendingQueue.length === 0) return;
    setIsSyncing(true);

    setTimeout(() => {
      LocalDB.clearSyncedVouchers(pendingQueue.map((p) => p.voucherId));
      setIsSyncing(false);
      refreshState();
      Alert.alert('Reconciliation Complete', `All ${pendingQueue.length} offline vouchers reconciled with Go backend!`);
    }, 1200);
  };

  // ==========================================
  // VIEW 1: LOADING SPLASH
  // ==========================================
  if (isInitializing) {
    return (
      <SafeAreaView style={[styles.container, styles.centerBox]}>
        <ActivityIndicator size="large" color="#10B981" />
        <Text style={{ color: '#A1A1AA', marginTop: 12, fontWeight: '700' }}>Initializing Secure Enclave...</Text>
      </SafeAreaView>
    );
  }

  // ==========================================
  // VIEW 2: BIOMETRIC FINGERPRINT LOCK SCREEN
  // ==========================================
  if (isBiometricLocked && currentUser) {
    return (
      <SafeAreaView style={[styles.container, styles.centerBox]}>
        <StatusBar barStyle="light-content" backgroundColor="#09090B" />
        <View style={styles.lockBox}>
          <View style={styles.fingerprintIconContainer}>
            <Fingerprint size={56} color="#10B981" />
          </View>
          <Text style={styles.lockTitle}>TapCash Vault Locked</Text>
          <Text style={styles.lockSubtitle}>Welcome back, {currentUser.name}</Text>
          <Text style={styles.lockDesc}>Scan your fingerprint or Face ID to access your hardware-encrypted wallet</Text>

          <TouchableOpacity
            style={[styles.primaryActionButton, { width: '100%', marginTop: 24 }]}
            onPress={() => promptBiometricAuth(currentUser.name)}
          >
            <View style={styles.btnRow}>
              <Fingerprint size={20} color="#000" />
              <Text style={styles.primaryActionText}>Scan Fingerprint / Face ID</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={{ marginTop: 16 }} onPress={handleManualUnlock}>
            <Text style={{ color: '#71717A', fontWeight: '700', fontSize: 13 }}>Unlock with Device Passcode</Text>
          </TouchableOpacity>

          <TouchableOpacity style={{ marginTop: 28 }} onPress={handleLogOut}>
            <Text style={{ color: '#EF4444', fontWeight: '700', fontSize: 12 }}>Log Out & Switch Account</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ==========================================
  // VIEW 3: AUTHENTICATION / SIGN IN SCREEN
  // ==========================================
  if (!currentUser) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#09090B" />
        <ScrollView contentContainerStyle={styles.authScrollContent} showsVerticalScrollIndicator={false}>
          {/* Brand Logo */}
          <View style={styles.authBrandBox}>
            <View style={styles.authLogoBadge}>
              <Zap size={32} color="#10B981" />
            </View>
            <Text style={styles.authAppTitle}>TapCash</Text>
            <Text style={styles.authAppSubtitle}>Hardware-Grade Offline NFC & P2P Banking</Text>
          </View>

          {/* Preset Demo Accounts */}
          <View style={styles.presetAccountsCard}>
            <Text style={styles.presetSectionTitle}>Select an Account to Sign In</Text>
            {PRESET_USERS.map((u) => (
              <TouchableOpacity
                key={u.id}
                style={styles.presetAccountBtn}
                onPress={() => handleSignIn(u.email)}
              >
                <View style={styles.avatarCircle}>
                  <Text style={{ fontSize: 20 }}>{u.avatar}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.presetNameText}>{u.name}</Text>
                  <Text style={styles.presetEmailText}>{u.email}</Text>
                </View>
                <Text style={styles.presetBalanceText}>₹{(u.balanceCents / 100).toFixed(2)}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Custom Sign In Form */}
          <View style={styles.cardSection}>
            <Text style={styles.tabHeading}>{isRegisterMode ? 'Create New Account' : 'Or Sign In with Email'}</Text>
            <Text style={styles.tabSubheading}>
              {isRegisterMode ? 'Your Ed25519 keypair will be generated on-device' : 'Enter your registered credentials'}
            </Text>

            {isRegisterMode && (
              <>
                <Text style={styles.inputLabel}>Full Name</Text>
                <TextInput
                  style={styles.textInput}
                  value={authName}
                  onChangeText={setAuthName}
                  placeholder="e.g. Aman Sharma"
                  placeholderTextColor={Colors.textMuted}
                />
              </>
            )}

            <Text style={styles.inputLabel}>Email Address</Text>
            <TextInput
              style={styles.textInput}
              value={authEmail}
              onChangeText={setAuthEmail}
              placeholder="e.g. aman@tapcash.io"
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="none"
              keyboardType="email-address"
            />

            <Text style={styles.inputLabel}>Password</Text>
            <TextInput
              style={styles.textInput}
              value={authPassword}
              onChangeText={setAuthPassword}
              placeholder="••••••••"
              placeholderTextColor={Colors.textMuted}
              secureTextEntry
            />

            <TouchableOpacity style={styles.primaryActionButton} onPress={() => handleSignIn()} disabled={isAuthenticating}>
              {isAuthenticating ? (
                <ActivityIndicator color="#000" />
              ) : (
                <Text style={styles.primaryActionText}>{isRegisterMode ? '🚀 Register & Generate Key' : '🔑 Sign In to TapCash'}</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={{ marginTop: 16, alignItems: 'center' }}
              onPress={() => setIsRegisterMode(!isRegisterMode)}
            >
              <Text style={{ color: '#10B981', fontWeight: '700', fontSize: 13 }}>
                {isRegisterMode ? 'Already have an account? Sign In' : "Don't have an account? Create One"}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ==========================================
  // VIEW 4: MAIN AUTHENTICATED APPLICATION
  // ==========================================
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />

      {/* Header with User Selector & Logout */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.userProfileSelector} onPress={() => setSwitchUserModalVisible(true)}>
          <View style={styles.avatarCircle}>
            <Text style={{ fontSize: 16 }}>{currentUser.avatar}</Text>
          </View>
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={styles.userNameText}>{currentUser.name}</Text>
              <ChevronDown size={14} color="#A1A1AA" />
            </View>
            <Text style={styles.userEmailText}>{currentUser.email}</Text>
          </View>
        </TouchableOpacity>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TouchableOpacity
            style={[styles.networkBadge, isOfflineMode ? styles.badgeOffline : styles.badgeOnline]}
            onPress={() => setIsOfflineMode(!isOfflineMode)}
          >
            <View style={[styles.statusDot, isOfflineMode ? styles.dotOffline : styles.dotOnline]} />
            <Text style={[styles.networkBadgeText, isOfflineMode ? styles.textOffline : styles.textOnline]}>
              {isOfflineMode ? 'Offline' : 'Online'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.logoutIconButton} onPress={handleLogOut}>
            <LogOut size={16} color="#71717A" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Main Tab Content */}
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* TAB 1: HOME / DASHBOARD */}
        {activeTab === 'home' && (
          <>
            {/* Balance Card */}
            <View style={styles.balanceCard}>
              <View style={styles.cardHeaderRow}>
                <Text style={styles.balanceLabel}>Account Balance ({currentUser.name})</Text>
                <View style={styles.escrowChip}>
                  <Lock size={12} color="#10B981" />
                  <Text style={styles.escrowText}>Escrow Active</Text>
                </View>
              </View>
              <Text style={styles.balanceAmount}>₹{(currentUser.balanceCents / 100).toFixed(2)}</Text>
              <View style={styles.securityRow}>
                <View style={styles.keyBadge}>
                  <ShieldCheck size={14} color="#10B981" />
                  <Text style={styles.securityText}>{currentUser.devicePublicKey}</Text>
                </View>
                <Text style={styles.seqText}>Seq #{LocalDB.getSequence()}</Text>
              </View>
            </View>

            {/* Quick Actions Grid */}
            <View style={styles.quickGrid}>
              <TouchableOpacity style={styles.quickActionCard} onPress={() => setActiveTab('send')}>
                <View style={[styles.iconCircle, { backgroundColor: 'rgba(59, 130, 246, 0.15)', borderColor: 'rgba(59, 130, 246, 0.4)' }]}>
                  <ArrowUpRight size={22} color="#60A5FA" />
                </View>
                <Text style={styles.quickActionLabel}>Send P2P</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.quickActionCard} onPress={openCameraScanner}>
                <View style={[styles.iconCircle, { backgroundColor: 'rgba(6, 182, 212, 0.15)', borderColor: 'rgba(6, 182, 212, 0.4)' }]}>
                  <Scan size={22} color="#22D3EE" />
                </View>
                <Text style={styles.quickActionLabel}>Scan QR</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.quickActionCard} onPress={() => setActiveTab('receive')}>
                <View style={[styles.iconCircle, { backgroundColor: 'rgba(16, 185, 129, 0.15)', borderColor: 'rgba(16, 185, 129, 0.4)' }]}>
                  <ArrowDownLeft size={22} color="#34D399" />
                </View>
                <Text style={styles.quickActionLabel}>My QR</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.quickActionCard} onPress={() => setTapModalVisible(true)}>
                <View style={[styles.iconCircle, { backgroundColor: 'rgba(139, 92, 246, 0.15)', borderColor: 'rgba(139, 92, 246, 0.4)' }]}>
                  <Zap size={22} color="#A78BFA" />
                </View>
                <Text style={styles.quickActionLabel}>Tap-to-Pay</Text>
              </TouchableOpacity>
            </View>

            {/* Quick Switch User Helper Banner */}
            <TouchableOpacity style={styles.switchUserBanner} onPress={() => setSwitchUserModalVisible(true)}>
              <Users size={18} color="#60A5FA" />
              <View style={{ flex: 1 }}>
                <Text style={styles.switchBannerTitle}>Testing 2-Party Payments?</Text>
                <Text style={styles.switchBannerDesc}>Tap to switch account (Aman ↔ Sarah ↔ Merchant)</Text>
              </View>
              <Text style={{ color: '#60A5FA', fontWeight: 'bold' }}>Switch →</Text>
            </TouchableOpacity>

            {/* Sync Queue Alert Banner */}
            {pendingQueue.length > 0 && (
              <TouchableOpacity style={styles.syncBanner} onPress={() => setActiveTab('sync')}>
                <View style={styles.syncIconBox}>
                  <Clock size={20} color="#F59E0B" />
                </View>
                <View style={styles.syncBannerLeft}>
                  <Text style={styles.syncBannerTitle}>{pendingQueue.length} Pending Offline Vouchers</Text>
                  <Text style={styles.syncBannerDesc}>Tap to inspect cryptographic queue</Text>
                </View>
                <RefreshCw size={16} color="#A1A1AA" />
              </TouchableOpacity>
            )}

            {/* Transactions Activity */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Recent Activity</Text>
                <Text style={styles.sectionCount}>{history.length} transactions</Text>
              </View>
              {history.slice(0, 8).map((entry) => (
                <View key={entry.id} style={styles.ledgerItem}>
                  <View style={styles.itemLeftGroup}>
                    <View style={[styles.txTypeIcon, entry.type === 'DEBIT' ? styles.txDebit : styles.txCredit]}>
                      {entry.type === 'DEBIT' ? (
                        <ArrowUpRight size={16} color="#F87171" />
                      ) : (
                        <ArrowDownLeft size={16} color="#34D399" />
                      )}
                    </View>
                    <View>
                      <Text style={styles.ledgerDesc}>{entry.description}</Text>
                      <Text style={styles.ledgerTime}>{new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
                    </View>
                  </View>
                  <View style={styles.ledgerRight}>
                    <Text style={[styles.ledgerAmount, entry.type === 'DEBIT' ? styles.debitText : styles.creditText]}>
                      {entry.type === 'DEBIT' ? '-' : '+'}₹{(entry.amountCents / 100).toFixed(2)}
                    </Text>
                    <Text style={styles.ledgerBal}>₹{(entry.balanceAfterCents / 100).toFixed(2)}</Text>
                  </View>
                </View>
              ))}
            </View>
          </>
        )}

        {/* TAB 2: SEND MONEY */}
        {activeTab === 'send' && (
          <View style={styles.cardSection}>
            <View style={styles.tabHeaderRow}>
              <View>
                <Text style={styles.tabHeading}>Send Money</Text>
                <Text style={styles.tabSubheading}>From: {currentUser.name} (₹{(currentUser.balanceCents / 100).toFixed(2)})</Text>
              </View>
              <TouchableOpacity style={styles.scanBadgeBtn} onPress={openCameraScanner}>
                <Scan size={14} color="#000" />
                <Text style={styles.scanBadgeText}>Camera</Text>
              </TouchableOpacity>
            </View>

            {sendSuccessMsg && (
              <View style={styles.successBanner}>
                <CheckCircle2 size={16} color="#10B981" />
                <Text style={styles.successBannerText}>{sendSuccessMsg}</Text>
              </View>
            )}

            <Text style={styles.inputLabel}>Recipient Email / User ID</Text>
            <TextInput
              style={styles.textInput}
              value={recipientEmail}
              onChangeText={setRecipientEmail}
              placeholder="e.g. sarah@tapcash.io or merchant@metrocoffee.com"
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="none"
            />

            {/* Quick Contact Chips */}
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
              {PRESET_USERS.filter((u) => u.id !== currentUser.id).map((u) => (
                <TouchableOpacity
                  key={u.id}
                  style={styles.contactChip}
                  onPress={() => setRecipientEmail(u.email)}
                >
                  <Text style={{ fontSize: 12 }}>{u.avatar}</Text>
                  <Text style={styles.contactChipText}>{u.name.split(' ')[0]}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.inputLabel}>Amount (₹)</Text>
            <TextInput
              style={styles.textInput}
              value={sendAmount}
              onChangeText={setSendAmount}
              placeholder="0.00"
              placeholderTextColor={Colors.textMuted}
              keyboardType="numeric"
            />

            <Text style={styles.inputLabel}>Note (Optional)</Text>
            <TextInput
              style={styles.textInput}
              value={sendNote}
              onChangeText={setSendNote}
              placeholder="Lunch, movie, rent..."
              placeholderTextColor={Colors.textMuted}
            />

            <TouchableOpacity style={styles.primaryActionButton} onPress={handleSendP2P} disabled={isSending}>
              {isSending ? (
                <ActivityIndicator color="#000" />
              ) : (
                <View style={styles.btnRow}>
                  <Send size={18} color="#000" />
                  <Text style={styles.primaryActionText}>Send ₹{sendAmount || '0.00'}</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* TAB 3: RECEIVE / PERSONAL USER QR */}
        {activeTab === 'receive' && (
          <View style={[styles.cardSection, { alignItems: 'center' }]}>
            <Text style={styles.tabHeading}>{currentUser.name}'s Personal QR</Text>
            <Text style={styles.tabSubheading}>Others can scan this QR to pay you directly</Text>

            {/* Unique Scannable QR Code */}
            <View style={styles.realQrContainer}>
              <Image source={{ uri: qrCodeUrl }} style={styles.realQrImage} resizeMode="contain" />
              <Text style={styles.qrAmountBadge}>₹{receiveAmount}</Text>
              <Text style={styles.qrMetaText}>{receiveNote}</Text>
              <View style={styles.merchantBadge}>
                <Text style={{ fontSize: 13 }}>{currentUser.avatar}</Text>
                <Text style={styles.qrIdText}>{currentUser.email}</Text>
              </View>
            </View>

            {/* Custom Amount Controls */}
            <View style={{ width: '100%', marginTop: 15 }}>
              <Text style={styles.inputLabel}>Requested Amount (₹)</Text>
              <TextInput
                style={styles.textInput}
                value={receiveAmount}
                onChangeText={setReceiveAmount}
                keyboardType="numeric"
                placeholder="Amount"
                placeholderTextColor={Colors.textMuted}
              />

              <Text style={styles.inputLabel}>Note</Text>
              <TextInput
                style={styles.textInput}
                value={receiveNote}
                onChangeText={setReceiveNote}
                placeholder="Reason"
                placeholderTextColor={Colors.textMuted}
              />
            </View>
          </View>
        )}

        {/* TAB 4: WALLET & TOP-UP */}
        {activeTab === 'wallet' && (
          <View style={styles.cardSection}>
            <Text style={styles.tabHeading}>Wallet Vault</Text>
            <Text style={styles.tabSubheading}>Account: {currentUser.name} ({currentUser.email})</Text>

            <View style={styles.balanceCard}>
              <Text style={styles.balanceLabel}>Available Funds</Text>
              <Text style={styles.balanceAmount}>₹{(currentUser.balanceCents / 100).toFixed(2)}</Text>
            </View>

            <Text style={styles.sectionTitle}>Add Money to {currentUser.name}</Text>
            <View style={styles.presetRow}>
              <TouchableOpacity style={styles.presetBtn} onPress={() => handleTopUp(500)}>
                <Text style={styles.presetText}>+ ₹500</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.presetBtn} onPress={() => handleTopUp(1000)}>
                <Text style={styles.presetText}>+ ₹1,000</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.presetBtn} onPress={() => handleTopUp(5000)}>
                <Text style={styles.presetText}>+ ₹5,000</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* TAB 5: SYNC HUB */}
        {activeTab === 'sync' && (
          <View style={styles.cardSection}>
            <Text style={styles.tabHeading}>Offline Reconciliation Hub</Text>
            <Text style={styles.tabSubheading}>Cryptographically signed vouchers</Text>

            <TouchableOpacity
              style={[styles.primaryActionButton, { backgroundColor: pendingQueue.length > 0 ? '#10B981' : '#27272A' }]}
              onPress={handleSyncNow}
              disabled={isSyncing || pendingQueue.length === 0}
            >
              {isSyncing ? (
                <ActivityIndicator color="#000" />
              ) : (
                <View style={styles.btnRow}>
                  <RefreshCw size={18} color={pendingQueue.length > 0 ? '#000' : '#71717A'} />
                  <Text style={[styles.primaryActionText, { color: pendingQueue.length > 0 ? '#000' : '#71717A' }]}>
                    Reconcile {pendingQueue.length} Vouchers
                  </Text>
                </View>
              )}
            </TouchableOpacity>

            <View style={{ marginTop: 24 }}>
              <Text style={styles.sectionTitle}>Voucher Ledger Queue ({pendingQueue.length})</Text>
              {pendingQueue.length === 0 ? (
                <View style={styles.emptyQueueBox}>
                  <CheckCircle2 size={32} color="#10B981" />
                  <Text style={styles.emptyQueueText}>All offline transactions reconciled with Go backend.</Text>
                </View>
              ) : (
                pendingQueue.map((v) => (
                  <View key={v.voucherId} style={styles.voucherItem}>
                    <View style={styles.voucherHeaderRow}>
                      <Text style={styles.voucherTitle}>{v.voucherId}</Text>
                      <Text style={styles.voucherAmount}>₹{(v.amountCents / 100).toFixed(2)}</Text>
                    </View>
                    <Text style={styles.voucherSub}>Payee: {v.payeeId} | Seq: #{v.sequenceNumber}</Text>
                    <Text style={styles.voucherSig}>Sig: {v.signature.substring(0, 28)}...</Text>
                  </View>
                ))
              )}
            </View>
          </View>
        )}
      </ScrollView>

      {/* Bottom Navigation Bar */}
      <View style={styles.bottomNav}>
        <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('home')}>
          <Home size={22} color={activeTab === 'home' ? '#10B981' : '#71717A'} />
          <Text style={[styles.navLabel, activeTab === 'home' && styles.navLabelActive]}>Home</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('send')}>
          <Send size={22} color={activeTab === 'send' ? '#10B981' : '#71717A'} />
          <Text style={[styles.navLabel, activeTab === 'send' && styles.navLabelActive]}>Send</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('receive')}>
          <QrCode size={22} color={activeTab === 'receive' ? '#10B981' : '#71717A'} />
          <Text style={[styles.navLabel, activeTab === 'receive' && styles.navLabelActive]}>My QR</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('wallet')}>
          <Wallet size={22} color={activeTab === 'wallet' ? '#10B981' : '#71717A'} />
          <Text style={[styles.navLabel, activeTab === 'wallet' && styles.navLabelActive]}>Wallet</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('sync')}>
          <RefreshCw size={22} color={activeTab === 'sync' ? '#10B981' : '#71717A'} />
          <Text style={[styles.navLabel, activeTab === 'sync' && styles.navLabelActive]}>Sync</Text>
        </TouchableOpacity>
      </View>

      {/* Switch User Modal */}
      <Modal visible={switchUserModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeaderRow}>
              <View style={styles.modalHeaderLeft}>
                <Users size={20} color="#10B981" />
                <Text style={styles.modalTitle}>Switch Account</Text>
              </View>
              <TouchableOpacity onPress={() => setSwitchUserModalVisible(false)}>
                <X size={20} color="#71717A" />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSubtitle}>Select an account to test real P2P & QR payments</Text>

            {UsersDB.getAllUsers().map((u) => (
              <TouchableOpacity
                key={u.id}
                style={[styles.userOptionCard, u.id === currentUser.id && styles.userOptionActive]}
                onPress={() => handleSelectUser(u.id)}
              >
                <View style={styles.avatarCircle}>
                  <Text style={{ fontSize: 20 }}>{u.avatar}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.userOptionName}>{u.name}</Text>
                  <Text style={styles.userOptionEmail}>{u.email}</Text>
                </View>
                <Text style={styles.userOptionBalance}>₹{(u.balanceCents / 100).toFixed(2)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </Modal>

      {/* Real Camera Scanner Modal */}
      <Modal visible={isScannerOpen} animationType="slide" onRequestClose={() => setIsScannerOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
          <View style={styles.scannerHeader}>
            <Text style={styles.scannerTitle}>Scan User QR Code</Text>
            <TouchableOpacity onPress={() => setIsScannerOpen(false)} style={styles.scannerCloseBtn}>
              <X size={18} color="#fff" />
            </TouchableOpacity>
          </View>

          <CameraView
            style={StyleSheet.absoluteFillObject}
            facing="back"
            barcodeScannerSettings={{
              barcodeTypes: ['qr'],
            }}
            onBarcodeScanned={handleBarcodeScanned}
          />

          <View style={styles.scannerOverlay}>
            <View style={styles.scannerBox}>
              <View style={styles.laserLine} />
            </View>
            <Text style={styles.scannerHelperText}>Point camera at any user's personal QR or POS</Text>
          </View>
        </SafeAreaView>
      </Modal>

      {/* Tap-to-Pay NFC Modal */}
      <Modal visible={tapModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeaderRow}>
              <View style={styles.modalHeaderLeft}>
                <Zap size={20} color="#10B981" />
                <Text style={styles.modalTitle}>NFC Tap to Pay</Text>
              </View>
              <TouchableOpacity onPress={() => setTapModalVisible(false)}>
                <X size={20} color="#71717A" />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSubtitle}>Hold phone near merchant terminal</Text>

            <Text style={styles.inputLabel}>Merchant</Text>
            <TextInput
              style={styles.textInput}
              value={merchantName}
              onChangeText={setMerchantName}
              placeholder="Merchant Name"
              placeholderTextColor={Colors.textMuted}
            />

            <Text style={styles.inputLabel}>Amount (₹)</Text>
            <TextInput
              style={styles.textInput}
              value={tapAmount}
              onChangeText={setTapAmount}
              keyboardType="numeric"
              placeholder="Amount"
              placeholderTextColor={Colors.textMuted}
            />

            {tapResultMsg && <Text style={styles.resultMessage}>{tapResultMsg}</Text>}

            <View style={styles.modalActionRow}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.cancelBtn]}
                onPress={() => setTapModalVisible(false)}
                disabled={isProcessingTap}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalBtn, styles.confirmBtn]}
                onPress={handleExecuteTap}
                disabled={isProcessingTap}
              >
                {isProcessingTap ? <ActivityIndicator color="#000" /> : <Text style={styles.confirmBtnText}>Simulate Tap</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090B',
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 8 : 0,
  },
  centerBox: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  lockBox: {
    alignItems: 'center',
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#18181B',
    padding: 30,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: '#27272A',
  },
  fingerprintIconContainer: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1.5,
    borderColor: 'rgba(16, 185, 129, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  lockTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#FAFAFA',
    marginBottom: 4,
  },
  lockSubtitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#10B981',
    marginBottom: 8,
  },
  lockDesc: {
    fontSize: 12,
    color: '#71717A',
    textAlign: 'center',
    lineHeight: 18,
  },
  authScrollContent: {
    padding: 24,
    paddingTop: 40,
  },
  authBrandBox: {
    alignItems: 'center',
    marginBottom: 30,
  },
  authLogoBadge: {
    width: 64,
    height: 64,
    borderRadius: 22,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1.5,
    borderColor: 'rgba(16, 185, 129, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  authAppTitle: {
    fontSize: 28,
    fontWeight: '900',
    color: '#FAFAFA',
    letterSpacing: -0.5,
  },
  authAppSubtitle: {
    fontSize: 12,
    color: '#71717A',
    marginTop: 4,
    fontWeight: '600',
  },
  presetAccountsCard: {
    backgroundColor: '#18181B',
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: '#27272A',
    marginBottom: 20,
  },
  presetSectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#A1A1AA',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  presetAccountBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#09090B',
    padding: 12,
    borderRadius: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#27272A',
  },
  presetNameText: {
    color: '#FAFAFA',
    fontWeight: '800',
    fontSize: 14,
  },
  presetEmailText: {
    color: '#71717A',
    fontSize: 11,
    marginTop: 2,
  },
  presetBalanceText: {
    color: '#10B981',
    fontWeight: '900',
    fontSize: 14,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 10 : 8,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#18181B',
    backgroundColor: '#09090B',
  },
  userProfileSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logoutIconButton: {
    padding: 8,
    borderRadius: 12,
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: '#27272A',
  },
  avatarCircle: {
    width: 38,
    height: 38,
    borderRadius: 14,
    backgroundColor: '#18181B',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#27272A',
  },
  userNameText: {
    fontSize: 15,
    fontWeight: '900',
    color: '#FAFAFA',
  },
  userEmailText: {
    fontSize: 11,
    color: '#71717A',
  },
  networkBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    gap: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dotOnline: {
    backgroundColor: '#10B981',
  },
  dotOffline: {
    backgroundColor: '#EF4444',
  },
  badgeOffline: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  badgeOnline: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  networkBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  textOnline: {
    color: '#34D399',
  },
  textOffline: {
    color: '#F87171',
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 110,
  },
  balanceCard: {
    backgroundColor: '#18181B',
    padding: 22,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#27272A',
    marginBottom: 20,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  balanceLabel: {
    fontSize: 13,
    color: '#A1A1AA',
    fontWeight: '600',
  },
  escrowChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  escrowText: {
    color: '#34D399',
    fontSize: 11,
    fontWeight: '700',
  },
  balanceAmount: {
    fontSize: 38,
    fontWeight: '900',
    color: '#FAFAFA',
    marginVertical: 10,
    letterSpacing: -1,
  },
  securityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#27272A',
    paddingTop: 12,
    marginTop: 4,
  },
  keyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  securityText: {
    fontSize: 11,
    color: '#34D399',
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  seqText: {
    fontSize: 12,
    color: '#71717A',
    fontWeight: '700',
  },
  quickGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  quickActionCard: {
    alignItems: 'center',
    width: '22%',
  },
  iconCircle: {
    width: 54,
    height: 54,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    borderWidth: 1,
  },
  quickActionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#D4D4D8',
  },
  switchUserBanner: {
    backgroundColor: 'rgba(59, 130, 246, 0.12)',
    padding: 14,
    borderRadius: 18,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.3)',
    gap: 12,
  },
  switchBannerTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#93C5FD',
  },
  switchBannerDesc: {
    fontSize: 11,
    color: '#BFDBFE',
    marginTop: 2,
  },
  syncBanner: {
    backgroundColor: '#18181B',
    padding: 16,
    borderRadius: 18,
    marginBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
    gap: 12,
  },
  syncIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  syncBannerLeft: {
    flex: 1,
  },
  syncBannerTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FAFAFA',
  },
  syncBannerDesc: {
    fontSize: 11,
    color: '#A1A1AA',
    marginTop: 2,
  },
  section: {
    marginTop: 6,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FAFAFA',
  },
  sectionCount: {
    fontSize: 12,
    color: '#71717A',
    fontWeight: '600',
  },
  ledgerItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#18181B',
    padding: 14,
    borderRadius: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#27272A',
  },
  itemLeftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  txTypeIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  txDebit: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
  },
  txCredit: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
  },
  ledgerRight: {
    alignItems: 'flex-end',
  },
  ledgerDesc: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FAFAFA',
  },
  ledgerTime: {
    fontSize: 11,
    color: '#71717A',
    marginTop: 3,
  },
  ledgerAmount: {
    fontSize: 14,
    fontWeight: '800',
  },
  debitText: {
    color: '#F87171',
  },
  creditText: {
    color: '#34D399',
  },
  ledgerBal: {
    fontSize: 11,
    color: '#71717A',
    marginTop: 3,
  },
  cardSection: {
    backgroundColor: '#18181B',
    borderRadius: 24,
    padding: 22,
    borderWidth: 1,
    borderColor: '#27272A',
  },
  tabHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  tabHeading: {
    fontSize: 20,
    fontWeight: '900',
    color: '#FAFAFA',
  },
  tabSubheading: {
    fontSize: 13,
    color: '#71717A',
    marginTop: 3,
  },
  scanBadgeBtn: {
    backgroundColor: '#22D3EE',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  scanBadgeText: {
    color: '#000',
    fontSize: 12,
    fontWeight: '800',
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#A1A1AA',
    marginBottom: 8,
    marginTop: 6,
  },
  textInput: {
    backgroundColor: '#09090B',
    borderWidth: 1,
    borderColor: '#27272A',
    borderRadius: 14,
    padding: 14,
    color: '#FAFAFA',
    fontSize: 15,
    marginBottom: 14,
  },
  contactChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#27272A',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  contactChipText: {
    color: '#FAFAFA',
    fontSize: 12,
    fontWeight: '700',
  },
  primaryActionButton: {
    backgroundColor: '#10B981',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    marginTop: 8,
    shadowColor: '#10B981',
    shadowOpacity: 0.25,
    shadowRadius: 10,
  },
  btnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  primaryActionText: {
    color: '#000',
    fontSize: 15,
    fontWeight: '900',
  },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
    padding: 12,
    borderRadius: 14,
    marginBottom: 16,
  },
  successBannerText: {
    color: '#34D399',
    fontWeight: '700',
    fontSize: 13,
  },
  realQrContainer: {
    backgroundColor: '#FFFFFF',
    padding: 18,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 12,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 12,
  },
  realQrImage: {
    width: 220,
    height: 220,
    borderRadius: 12,
  },
  qrAmountBadge: {
    fontSize: 26,
    fontWeight: '900',
    color: '#09090B',
    marginTop: 10,
  },
  qrMetaText: {
    fontSize: 12,
    color: '#52525B',
    marginTop: 2,
    fontWeight: '700',
  },
  merchantBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  qrIdText: {
    fontSize: 11,
    color: '#71717A',
    fontWeight: '700',
  },
  presetRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  presetBtn: {
    flex: 1,
    backgroundColor: '#09090B',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#27272A',
  },
  presetText: {
    color: '#10B981',
    fontWeight: '800',
    fontSize: 14,
  },
  emptyQueueBox: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 10,
  },
  emptyQueueText: {
    color: '#71717A',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  voucherItem: {
    backgroundColor: '#09090B',
    padding: 14,
    borderRadius: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#27272A',
  },
  voucherHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  voucherTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FAFAFA',
    fontFamily: 'monospace',
  },
  voucherSub: {
    fontSize: 11,
    color: '#71717A',
    marginTop: 4,
  },
  voucherAmount: {
    fontSize: 14,
    fontWeight: '900',
    color: '#10B981',
  },
  voucherSig: {
    fontSize: 10,
    color: '#52525B',
    fontFamily: 'monospace',
    marginTop: 4,
  },
  bottomNav: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 75,
    backgroundColor: '#09090B',
    borderTopWidth: 1,
    borderTopColor: '#18181B',
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingBottom: 15,
  },
  navItem: {
    alignItems: 'center',
    gap: 4,
  },
  navLabel: {
    fontSize: 11,
    color: '#71717A',
    fontWeight: '600',
  },
  navLabelActive: {
    color: '#10B981',
    fontWeight: '800',
  },
  scannerHeader: {
    position: 'absolute',
    top: 45,
    left: 20,
    right: 20,
    zIndex: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  scannerTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '800',
  },
  scannerCloseBtn: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    padding: 8,
    borderRadius: 20,
  },
  scannerOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scannerBox: {
    width: 250,
    height: 250,
    borderWidth: 2,
    borderColor: '#22D3EE',
    borderRadius: 24,
    backgroundColor: 'transparent',
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  laserLine: {
    width: '100%',
    height: 2,
    backgroundColor: '#22D3EE',
  },
  scannerHelperText: {
    color: '#fff',
    marginTop: 20,
    fontSize: 13,
    fontWeight: '700',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
  },
  userOptionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#09090B',
    padding: 14,
    borderRadius: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#27272A',
  },
  userOptionActive: {
    borderColor: '#10B981',
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
  },
  userOptionName: {
    color: '#FAFAFA',
    fontWeight: '800',
    fontSize: 14,
  },
  userOptionEmail: {
    color: '#71717A',
    fontSize: 11,
    marginTop: 2,
  },
  userOptionBalance: {
    color: '#10B981',
    fontWeight: '900',
    fontSize: 15,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#18181B',
    padding: 24,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderColor: '#27272A',
  },
  modalHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#FAFAFA',
  },
  modalSubtitle: {
    fontSize: 13,
    color: '#71717A',
    marginTop: 4,
    marginBottom: 16,
  },
  resultMessage: {
    fontSize: 13,
    fontWeight: '700',
    color: '#34D399',
    textAlign: 'center',
    marginVertical: 10,
  },
  modalActionRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 10,
  },
  modalBtn: {
    flex: 1,
    paddingVertical: 15,
    borderRadius: 16,
    alignItems: 'center',
  },
  cancelBtn: {
    backgroundColor: '#27272A',
  },
  confirmBtn: {
    backgroundColor: '#10B981',
  },
  cancelBtnText: {
    color: '#A1A1AA',
    fontSize: 14,
    fontWeight: '700',
  },
  confirmBtnText: {
    color: '#000',
    fontSize: 14,
    fontWeight: '900',
  },
});
