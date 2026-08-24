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
} from 'react-native';
import { Colors } from './src/core/theme/colors';
import { LocalDB, LocalLedgerEntry, PendingVoucher } from './src/core/database/sqlite';
import { MockTapBridge } from './src/features/tap_to_pay/mockTapBridge';

export default function App() {
  const [balance, setBalance] = useState(LocalDB.getBalance());
  const [history, setHistory] = useState<LocalLedgerEntry[]>(LocalDB.getHistory());
  const [pendingQueue, setPendingQueue] = useState<PendingVoucher[]>(LocalDB.getPendingQueue());
  const [isOfflineMode, setIsOfflineMode] = useState(true);

  // Tap-to-Pay Modal States
  const [tapModalVisible, setTapModalVisible] = useState(false);
  const [tapAmount, setTapAmount] = useState('250');
  const [merchantName, setMerchantName] = useState('Metro Coffee Store');
  const [isProcessingTap, setIsProcessingTap] = useState(false);
  const [tapResultMsg, setTapResultMsg] = useState<string | null>(null);

  // Sync Hub States
  const [isSyncing, setIsSyncing] = useState(false);

  const refreshState = () => {
    setBalance(LocalDB.getBalance());
    setHistory(LocalDB.getHistory());
    setPendingQueue(LocalDB.getPendingQueue());
  };

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
      setTapResultMsg(`✅ Settled locally in ${res.latencyMs}ms! (Ed25519 Signed Voucher Created)`);
      setTimeout(() => {
        setTapModalVisible(false);
        setTapResultMsg(null);
      }, 1500);
    } else {
      setTapResultMsg(`❌ Failed: ${res.error}`);
    }
  };

  const handleSyncNow = async () => {
    if (pendingQueue.length === 0) return;
    setIsSyncing(true);

    // Simulate batch sync request to Go Backend
    setTimeout(() => {
      LocalDB.clearSyncedVouchers(pendingQueue.map((p) => p.voucherId));
      setIsSyncing(false);
      refreshState();
    }, 1200);
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.appTitle}>TapCash</Text>
          <Text style={styles.appSubtitle}>Offline NFC & P2P Ledger</Text>
        </View>
        <TouchableOpacity
          style={[styles.networkBadge, isOfflineMode ? styles.badgeOffline : styles.badgeOnline]}
          onPress={() => setIsOfflineMode(!isOfflineMode)}
        >
          <Text style={styles.networkBadgeText}>
            {isOfflineMode ? '🔴 Offline Mode' : '🟢 Online Mode'}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Balance Card */}
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Available Offline Balance</Text>
          <Text style={styles.balanceAmount}>₹{(balance / 100).toFixed(2)}</Text>
          <View style={styles.securityRow}>
            <Text style={styles.securityText}>🔒 Ed25519 Keystore Active</Text>
            <Text style={styles.seqText}>Seq: #{LocalDB.getSequence()}</Text>
          </View>
        </View>

        {/* Action Buttons */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.primaryBtn]}
            onPress={() => setTapModalVisible(true)}
          >
            <Text style={styles.actionBtnText}>⚡ Tap to Pay (NFC)</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, styles.secondaryBtn]}
            onPress={handleSyncNow}
            disabled={isSyncing || pendingQueue.length === 0}
          >
            {isSyncing ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.actionBtnText}>
                🔄 Sync Hub ({pendingQueue.length})
              </Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Sync Queue Banner */}
        {pendingQueue.length > 0 && (
          <View style={styles.syncBanner}>
            <Text style={styles.syncBannerTitle}>
              ⏳ {pendingQueue.length} Pending Offline Vouchers
            </Text>
            <Text style={styles.syncBannerDesc}>
              Ready for conflict-free reconciliation when network is available.
            </Text>
          </View>
        )}

        {/* Local Double-Entry Ledger History */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Immutable Local Ledger</Text>
          {history.map((entry) => (
            <View key={entry.id} style={styles.ledgerItem}>
              <View style={styles.ledgerLeft}>
                <Text style={styles.ledgerDesc}>{entry.description}</Text>
                <Text style={styles.ledgerTime}>
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </Text>
              </View>
              <View style={styles.ledgerRight}>
                <Text
                  style={[
                    styles.ledgerAmount,
                    entry.type === 'DEBIT' ? styles.debitText : styles.creditText,
                  ]}
                >
                  {entry.type === 'DEBIT' ? '-' : '+'}₹{(entry.amountCents / 100).toFixed(2)}
                </Text>
                <Text style={styles.ledgerBal}>
                  Bal: ₹{(entry.balanceAfterCents / 100).toFixed(2)}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

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

            {tapResultMsg && (
              <Text style={styles.resultMessage}>{tapResultMsg}</Text>
            )}

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
                {isProcessingTap ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.modalBtnText}>Simulate Tap</Text>
                )}
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
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
  },
  appTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: 0.5,
  },
  appSubtitle: {
    fontSize: 12,
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
    fontSize: 14,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  balanceAmount: {
    fontSize: 38,
    fontWeight: '900',
    color: Colors.textPrimary,
    marginVertical: 10,
    letterSpacing: -1,
  },
  securityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
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
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtn: {
    backgroundColor: Colors.primary,
  },
  secondaryBtn: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  actionBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  syncBanner: {
    backgroundColor: '#27272A',
    padding: 16,
    borderRadius: 14,
    marginBottom: 20,
    borderLeftWidth: 4,
    borderLeftColor: Colors.warning,
  },
  syncBannerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  syncBannerDesc: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 4,
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
    padding: 16,
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
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  ledgerTime: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 4,
  },
  ledgerAmount: {
    fontSize: 15,
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
    marginBottom: 20,
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
