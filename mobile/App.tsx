import React, { useState } from 'react';
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
import { Colors } from './src/core/theme/colors';
import { LocalDB, LocalLedgerEntry, PendingVoucher } from './src/core/database/sqlite';
import { MockTapBridge } from './src/features/tap_to_pay/mockTapBridge';

type ActiveTab = 'home' | 'send' | 'receive' | 'wallet' | 'sync';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('home');
  const [balance, setBalance] = useState(LocalDB.getBalance());
  const [history, setHistory] = useState<LocalLedgerEntry[]>(LocalDB.getHistory());
  const [pendingQueue, setPendingQueue] = useState<PendingVoucher[]>(LocalDB.getPendingQueue());
  const [isOfflineMode, setIsOfflineMode] = useState(false);

  // Send Online / P2P State
  const [recipientEmail, setRecipientEmail] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [sendNote, setSendNote] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendSuccessMsg, setSendSuccessMsg] = useState<string | null>(null);

  // Scanner Modal State
  const [scannerModalVisible, setScannerModalVisible] = useState(false);

  // Receive / POS State
  const [receiveAmount, setReceiveAmount] = useState('150');
  const [receiveNote, setReceiveNote] = useState('Payment for Chai & Snacks');

  // Top Up & Escrow State
  const [isToppingUp, setIsToppingUp] = useState(false);

  // Tap-to-Pay NFC Modal
  const [tapModalVisible, setTapModalVisible] = useState(false);
  const [tapAmount, setTapAmount] = useState('150');
  const [merchantName, setMerchantName] = useState('Metro Coffee Store');
  const [isProcessingTap, setIsProcessingTap] = useState(false);
  const [tapResultMsg, setTapResultMsg] = useState<string | null>(null);

  // Sync Hub
  const [isSyncing, setIsSyncing] = useState(false);

  const refreshState = () => {
    setBalance(LocalDB.getBalance());
    setHistory(LocalDB.getHistory());
    setPendingQueue(LocalDB.getPendingQueue());
  };

  // Dynamic QR Code URL encoder
  const qrPayload = JSON.stringify({
    type: 'TAPCASH_PAY_INTENT',
    payee: 'usr_merchant_77a9',
    name: 'Metro Coffee Store',
    amount: receiveAmount,
    note: receiveNote,
    timestamp: Date.now(),
  });
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(qrPayload)}&bgcolor=ffffff&color=09090b&margin=2`;

  // 1. Send Online P2P Transfer
  const handleSendP2P = async () => {
    const amountNum = parseFloat(sendAmount);
    if (!recipientEmail || isNaN(amountNum) || amountNum <= 0) {
      Alert.alert('Invalid Input', 'Please enter recipient email and valid amount.');
      return;
    }

    const amountCents = Math.round(amountNum * 100);
    if (balance < amountCents) {
      Alert.alert('Insufficient Balance', 'You do not have enough balance.');
      return;
    }

    setIsSending(true);
    setSendSuccessMsg(null);

    setTimeout(() => {
      const voucher: PendingVoucher = {
        voucherId: `vch_p2p_${Date.now()}`,
        payerPublicKey: 'pub_device_payer_key_99',
        payeeId: recipientEmail,
        amountCents,
        currency: 'INR',
        sequenceNumber: LocalDB.getSequence() + 1,
        timestamp: Date.now(),
        nonce: `nonce_p2p_${Date.now()}`,
        signature: 'ed25519_p2p_sig_valid',
        status: isOfflineMode ? 'PENDING' : 'SYNCED',
      };

      LocalDB.recordOfflineDebit(voucher, `P2P Sent to ${recipientEmail} (${sendNote || 'Transfer'})`);
      setIsSending(false);
      refreshState();
      setSendSuccessMsg(`✅ ₹${amountNum.toFixed(2)} sent successfully to ${recipientEmail}!`);
      setSendAmount('');
      setRecipientEmail('');
      setSendNote('');
    }, 800);
  };

  // Simulate scanning QR Code
  const handleSimulateScan = (scannedAmount: string, scannedMerchant: string) => {
    setScannerModalVisible(false);
    setActiveTab('send');
    setRecipientEmail(scannedMerchant);
    setSendAmount(scannedAmount);
    setSendNote('Scanned via Dynamic QR');
    Alert.alert('QR Code Scanned!', `Payment intent loaded: ₹${scannedAmount} to ${scannedMerchant}`);
  };

  // 2. Top-Up Wallet Balance
  const handleTopUp = (amt: number) => {
    setIsToppingUp(true);
    setTimeout(() => {
      const voucher: PendingVoucher = {
        voucherId: `topup_${Date.now()}`,
        payerPublicKey: 'bank_gateway',
        payeeId: 'self',
        amountCents: amt * 100,
        currency: 'INR',
        sequenceNumber: LocalDB.getSequence(),
        timestamp: Date.now(),
        nonce: `topup_nonce_${Date.now()}`,
        signature: 'bank_verified',
        status: 'SYNCED',
      };
      LocalDB.recordOfflineCredit(voucher, `Top-Up via UPI/Bank (+₹${amt})`);
      setIsToppingUp(false);
      refreshState();
      Alert.alert('Top-Up Success', `₹${amt} added to your TapCash Wallet!`);
    }, 600);
  };

  // 3. NFC Tap-to-Pay Beam
  const handleExecuteTap = async () => {
    const amountNum = parseFloat(tapAmount);
    if (isNaN(amountNum) || amountNum <= 0) return;

    setIsProcessingTap(true);
    setTapResultMsg(null);

    const res = await MockTapBridge.executeNfcExchange({
      payeeId: 'usr_merchant_coffee_99',
      payeeName: merchantName,
      amountCents: Math.round(amountNum * 100),
    });

    setIsProcessingTap(false);
    refreshState();

    if (res.success) {
      setTapResultMsg(`✅ Settled in ${res.latencyMs}ms! (Ed25519 Signed Voucher Created)`);
      setTimeout(() => {
        setTapModalVisible(false);
        setTapResultMsg(null);
      }, 1500);
    } else {
      setTapResultMsg(`❌ Failed: ${res.error}`);
    }
  };

  // 4. Batch Sync to Backend
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

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />

      {/* Header with Safe Status Bar Offset */}
      <View style={styles.header}>
        <View>
          <Text style={styles.appTitle}>TapCash</Text>
          <Text style={styles.appSubtitle}>Offline NFC & Dynamic QR</Text>
        </View>
        <TouchableOpacity
          style={[styles.networkBadge, isOfflineMode ? styles.badgeOffline : styles.badgeOnline]}
          onPress={() => setIsOfflineMode(!isOfflineMode)}
        >
          <Text style={styles.networkBadgeText}>
            {isOfflineMode ? '🔴 Offline' : '🟢 Online'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Main Tab Content */}
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* TAB 1: HOME / DASHBOARD */}
        {activeTab === 'home' && (
          <>
            {/* Balance Card */}
            <View style={styles.balanceCard}>
              <Text style={styles.balanceLabel}>Total Available Balance</Text>
              <Text style={styles.balanceAmount}>₹{(balance / 100).toFixed(2)}</Text>
              <View style={styles.securityRow}>
                <Text style={styles.securityText}>🔒 Ed25519 Keystore Active</Text>
                <Text style={styles.seqText}>Seq: #{LocalDB.getSequence()}</Text>
              </View>
            </View>

            {/* Quick Actions Grid */}
            <View style={styles.quickGrid}>
              <TouchableOpacity style={styles.quickActionCard} onPress={() => setActiveTab('send')}>
                <View style={[styles.iconCircle, { backgroundColor: '#3B82F6' }]}>
                  <Text style={styles.iconEmoji}>↗</Text>
                </View>
                <Text style={styles.quickActionLabel}>Send P2P</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.quickActionCard} onPress={() => setScannerModalVisible(true)}>
                <View style={[styles.iconCircle, { backgroundColor: '#06B6D4' }]}>
                  <Text style={styles.iconEmoji}>📷</Text>
                </View>
                <Text style={styles.quickActionLabel}>Scan QR</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.quickActionCard} onPress={() => setActiveTab('receive')}>
                <View style={[styles.iconCircle, { backgroundColor: '#10B981' }]}>
                  <Text style={styles.iconEmoji}>↙</Text>
                </View>
                <Text style={styles.quickActionLabel}>Receive QR</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.quickActionCard} onPress={() => setTapModalVisible(true)}>
                <View style={[styles.iconCircle, { backgroundColor: '#8B5CF6' }]}>
                  <Text style={styles.iconEmoji}>⚡</Text>
                </View>
                <Text style={styles.quickActionLabel}>Tap-to-Pay</Text>
              </TouchableOpacity>
            </View>

            {/* Sync Queue Alert */}
            {pendingQueue.length > 0 && (
              <TouchableOpacity style={styles.syncBanner} onPress={() => setActiveTab('sync')}>
                <View style={styles.syncBannerLeft}>
                  <Text style={styles.syncBannerTitle}>⏳ {pendingQueue.length} Pending Vouchers</Text>
                  <Text style={styles.syncBannerDesc}>Tap to view offline ledger & reconcile</Text>
                </View>
                <Text style={styles.syncArrow}>→</Text>
              </TouchableOpacity>
            )}

            {/* Immutable Ledger Activity */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Recent Transactions</Text>
              {history.slice(0, 8).map((entry) => (
                <View key={entry.id} style={styles.ledgerItem}>
                  <View style={styles.ledgerLeft}>
                    <Text style={styles.ledgerDesc}>{entry.description}</Text>
                    <Text style={styles.ledgerTime}>{new Date(entry.timestamp).toLocaleTimeString()}</Text>
                  </View>
                  <View style={styles.ledgerRight}>
                    <Text style={[styles.ledgerAmount, entry.type === 'DEBIT' ? styles.debitText : styles.creditText]}>
                      {entry.type === 'DEBIT' ? '-' : '+'}₹{(entry.amountCents / 100).toFixed(2)}
                    </Text>
                    <Text style={styles.ledgerBal}>Bal: ₹{(entry.balanceAfterCents / 100).toFixed(2)}</Text>
                  </View>
                </View>
              ))}
            </View>
          </>
        )}

        {/* TAB 2: SEND MONEY */}
        {activeTab === 'send' && (
          <View style={styles.cardSection}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
              <View>
                <Text style={styles.tabHeading}>Send Money</Text>
                <Text style={styles.tabSubheading}>Transfer to friend or merchant</Text>
              </View>
              <TouchableOpacity
                style={styles.scanBadgeBtn}
                onPress={() => setScannerModalVisible(true)}
              >
                <Text style={styles.scanBadgeText}>📷 Scan QR</Text>
              </TouchableOpacity>
            </View>

            {sendSuccessMsg && <Text style={styles.successBanner}>{sendSuccessMsg}</Text>}

            <Text style={styles.inputLabel}>Recipient Email or Merchant ID</Text>
            <TextInput
              style={styles.textInput}
              value={recipientEmail}
              onChangeText={setRecipientEmail}
              placeholder="alex@tapcash.io or usr_merchant_77"
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="none"
            />

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
              placeholder="Coffee, dinner, groceries..."
              placeholderTextColor={Colors.textMuted}
            />

            <TouchableOpacity style={styles.primaryActionButton} onPress={handleSendP2P} disabled={isSending}>
              {isSending ? <ActivityIndicator color="#000" /> : <Text style={styles.primaryActionText}>🚀 Send ₹{sendAmount || '0.00'}</Text>}
            </TouchableOpacity>
          </View>
        )}

        {/* TAB 3: RECEIVE / DYNAMIC SCANNABLE QR */}
        {activeTab === 'receive' && (
          <View style={[styles.cardSection, { alignItems: 'center' }]}>
            <Text style={styles.tabHeading}>Receive Payment</Text>
            <Text style={styles.tabSubheading}>Scan this QR code from any camera/scanner to pay</Text>

            {/* Real Dynamic Scannable QR Code Image */}
            <View style={styles.realQrContainer}>
              <Image
                source={{ uri: qrCodeUrl }}
                style={styles.realQrImage}
                resizeMode="contain"
              />
              <Text style={styles.qrAmountBadge}>₹{receiveAmount}</Text>
              <Text style={styles.qrMetaText}>{receiveNote}</Text>
              <Text style={styles.qrIdText}>ID: usr_merchant_77a9</Text>
            </View>

            {/* Custom Amount Controls */}
            <View style={{ width: '100%', marginTop: 20 }}>
              <Text style={styles.inputLabel}>Set Receive Amount (₹)</Text>
              <TextInput
                style={styles.textInput}
                value={receiveAmount}
                onChangeText={setReceiveAmount}
                keyboardType="numeric"
                placeholder="Amount"
                placeholderTextColor={Colors.textMuted}
              />

              <Text style={styles.inputLabel}>Payment Note</Text>
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
            <Text style={styles.tabHeading}>Wallet & Escrow</Text>
            <Text style={styles.tabSubheading}>Add funds to wallet and manage offline balance</Text>

            <View style={styles.balanceCard}>
              <Text style={styles.balanceLabel}>Current Balance</Text>
              <Text style={styles.balanceAmount}>₹{(balance / 100).toFixed(2)}</Text>
            </View>

            <Text style={styles.sectionTitle}>Quick Top-Up</Text>
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
            <Text style={styles.tabSubheading}>Vouchers signed offline awaiting batch submission</Text>

            <TouchableOpacity
              style={[styles.primaryActionButton, { backgroundColor: pendingQueue.length > 0 ? Colors.primary : Colors.surfaceBorder }]}
              onPress={handleSyncNow}
              disabled={isSyncing || pendingQueue.length === 0}
            >
              {isSyncing ? (
                <ActivityIndicator color="#000" />
              ) : (
                <Text style={styles.primaryActionText}>🔄 Reconcile {pendingQueue.length} Vouchers with Go Backend</Text>
              )}
            </TouchableOpacity>

            <View style={{ marginTop: 20 }}>
              <Text style={styles.sectionTitle}>Pending Voucher Queue ({pendingQueue.length})</Text>
              {pendingQueue.length === 0 ? (
                <Text style={{ color: Colors.textMuted, fontStyle: 'italic', marginTop: 10 }}>No pending offline vouchers. All transactions settled.</Text>
              ) : (
                pendingQueue.map((v) => (
                  <View key={v.voucherId} style={styles.voucherItem}>
                    <Text style={styles.voucherTitle}>{v.voucherId}</Text>
                    <Text style={styles.voucherSub}>Payee: {v.payeeId} | Seq: #{v.sequenceNumber}</Text>
                    <Text style={styles.voucherAmount}>Amount: ₹{(v.amountCents / 100).toFixed(2)}</Text>
                    <Text style={styles.voucherSig}>Sig: {v.signature.substring(0, 30)}...</Text>
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
          <Text style={[styles.navIcon, activeTab === 'home' && styles.navActive]}>🏠</Text>
          <Text style={[styles.navLabel, activeTab === 'home' && styles.navLabelActive]}>Home</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('send')}>
          <Text style={[styles.navIcon, activeTab === 'send' && styles.navActive]}>↗</Text>
          <Text style={[styles.navLabel, activeTab === 'send' && styles.navLabelActive]}>Send</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('receive')}>
          <Text style={[styles.navIcon, activeTab === 'receive' && styles.navActive]}>↙</Text>
          <Text style={[styles.navLabel, activeTab === 'receive' && styles.navLabelActive]}>Receive</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('wallet')}>
          <Text style={[styles.navIcon, activeTab === 'wallet' && styles.navActive]}>💳</Text>
          <Text style={[styles.navLabel, activeTab === 'wallet' && styles.navLabelActive]}>Wallet</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('sync')}>
          <Text style={[styles.navIcon, activeTab === 'sync' && styles.navActive]}>🔄</Text>
          <Text style={[styles.navLabel, activeTab === 'sync' && styles.navLabelActive]}>Sync</Text>
        </TouchableOpacity>
      </View>

      {/* QR Scanner Simulator Modal */}
      <Modal visible={scannerModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>📷 Scan Merchant QR</Text>
            <Text style={styles.modalSubtitle}>Point camera at Laptop POS or Merchant Code</Text>

            <View style={styles.scannerViewport}>
              <View style={styles.laserLine} />
              <Text style={{ color: '#fff', fontWeight: 'bold' }}>Align QR in frame</Text>
            </View>

            <Text style={[styles.inputLabel, { marginTop: 15 }]}>Simulate Detected QR Codes:</Text>
            <TouchableOpacity
              style={styles.scannedOptionBtn}
              onPress={() => handleSimulateScan('150', 'Metro Coffee Store')}
            >
              <Text style={styles.scannedOptionTitle}>☕ Metro Coffee Store (₹150)</Text>
              <Text style={styles.scannedOptionSub}>Match Laptop POS Terminal</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.scannedOptionBtn}
              onPress={() => handleSimulateScan('350', 'Chai Point')}
            >
              <Text style={styles.scannedOptionTitle}>🍵 Chai Point (₹350)</Text>
              <Text style={styles.scannedOptionSub}>P2M Merchant QR</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.modalBtn, styles.cancelBtn, { marginTop: 10 }]}
              onPress={() => setScannerModalVisible(false)}
            >
              <Text style={styles.modalBtnText}>Close Scanner</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Tap-to-Pay NFC Modal */}
      <Modal visible={tapModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>NFC Tap to Pay</Text>
            <Text style={styles.modalSubtitle}>Hold device near merchant terminal</Text>

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
                <Text style={styles.modalBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalBtn, styles.confirmBtn]}
                onPress={handleExecuteTap}
                disabled={isProcessingTap}
              >
                {isProcessingTap ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalBtnText}>Simulate Tap</Text>}
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
    backgroundColor: Colors.background,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 8 : 0,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 10 : 8,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
    backgroundColor: Colors.background,
  },
  appTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: Colors.textPrimary,
    letterSpacing: 0.5,
  },
  appSubtitle: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  networkBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  badgeOffline: {
    backgroundColor: '#3F1D1D',
  },
  badgeOnline: {
    backgroundColor: '#064E3B',
  },
  networkBadgeText: {
    color: Colors.textPrimary,
    fontSize: 12,
    fontWeight: '600',
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 110,
  },
  balanceCard: {
    backgroundColor: Colors.surface,
    padding: 24,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    marginBottom: 20,
  },
  balanceLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  balanceAmount: {
    fontSize: 38,
    fontWeight: '900',
    color: Colors.textPrimary,
    marginVertical: 8,
    letterSpacing: -1,
  },
  securityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  securityText: {
    fontSize: 12,
    color: Colors.primary,
    fontWeight: '600',
  },
  seqText: {
    fontSize: 12,
    color: Colors.textMuted,
    fontWeight: '600',
  },
  quickGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  quickActionCard: {
    alignItems: 'center',
    width: '22%',
  },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 5,
  },
  iconEmoji: {
    fontSize: 22,
    color: '#fff',
    fontWeight: 'bold',
  },
  quickActionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  syncBanner: {
    backgroundColor: '#27272A',
    padding: 16,
    borderRadius: 16,
    marginBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderLeftWidth: 4,
    borderLeftColor: Colors.warning,
  },
  syncBannerLeft: {
    flex: 1,
  },
  syncBannerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  syncBannerDesc: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 3,
  },
  syncArrow: {
    fontSize: 18,
    color: Colors.textPrimary,
    fontWeight: 'bold',
  },
  section: {
    marginTop: 10,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 12,
  },
  ledgerItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    padding: 14,
    borderRadius: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  ledgerLeft: {
    flex: 1,
  },
  ledgerRight: {
    alignItems: 'flex-end',
  },
  ledgerDesc: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  ledgerTime: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 4,
  },
  ledgerAmount: {
    fontSize: 14,
    fontWeight: '700',
  },
  debitText: {
    color: Colors.danger,
  },
  creditText: {
    color: Colors.success,
  },
  ledgerBal: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 4,
  },
  cardSection: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  tabHeading: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  tabSubheading: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 4,
    marginBottom: 15,
  },
  scanBadgeBtn: {
    backgroundColor: '#06B6D4',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  scanBadgeText: {
    color: '#000',
    fontSize: 12,
    fontWeight: '800',
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
    marginBottom: 6,
  },
  textInput: {
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderRadius: 12,
    padding: 12,
    color: Colors.textPrimary,
    fontSize: 15,
    marginBottom: 16,
  },
  primaryActionButton: {
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 10,
  },
  primaryActionText: {
    color: '#000',
    fontSize: 15,
    fontWeight: '800',
  },
  successBanner: {
    backgroundColor: '#064E3B',
    color: '#A7F3D0',
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
    fontWeight: '600',
    fontSize: 13,
    textAlign: 'center',
  },
  realQrContainer: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 10,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
  },
  realQrImage: {
    width: 200,
    height: 200,
    borderRadius: 12,
  },
  qrAmountBadge: {
    fontSize: 26,
    fontWeight: '900',
    color: '#09090b',
    marginTop: 8,
  },
  qrMetaText: {
    fontSize: 12,
    color: '#52525b',
    marginTop: 2,
    fontWeight: '600',
  },
  qrIdText: {
    fontSize: 10,
    color: '#a1a1aa',
    fontFamily: 'monospace',
    marginTop: 4,
  },
  presetRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  presetBtn: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  presetText: {
    color: Colors.primary,
    fontWeight: '700',
    fontSize: 14,
  },
  voucherItem: {
    backgroundColor: Colors.background,
    padding: 12,
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  voucherTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textPrimary,
    fontFamily: 'monospace',
  },
  voucherSub: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  voucherAmount: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.primary,
    marginTop: 4,
  },
  voucherSig: {
    fontSize: 10,
    color: Colors.textMuted,
    fontFamily: 'monospace',
    marginTop: 4,
  },
  bottomNav: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 75,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingBottom: 15,
  },
  navItem: {
    alignItems: 'center',
  },
  navIcon: {
    fontSize: 20,
    color: Colors.textMuted,
  },
  navLabel: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
    fontWeight: '500',
  },
  navActive: {
    color: Colors.primary,
  },
  navLabelActive: {
    color: Colors.primary,
    fontWeight: '700',
  },
  scannerViewport: {
    height: 160,
    backgroundColor: '#000',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#06B6D4',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 10,
    position: 'relative',
  },
  laserLine: {
    width: '80%',
    height: 2,
    backgroundColor: '#06B6D4',
    position: 'absolute',
  },
  scannedOptionBtn: {
    backgroundColor: Colors.background,
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  scannedOptionTitle: {
    color: Colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  scannedOptionSub: {
    color: Colors.textSecondary,
    fontSize: 11,
    marginTop: 2,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: Colors.surface,
    padding: 24,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  modalSubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 4,
    marginBottom: 15,
  },
  resultMessage: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.primary,
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
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  cancelBtn: {
    backgroundColor: Colors.surfaceBorder,
  },
  confirmBtn: {
    backgroundColor: Colors.primary,
  },
  modalBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
});
