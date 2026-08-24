export interface UserProfile {
  id: string;
  name: string;
  email: string;
  avatar: string;
  devicePublicKey: string;
  balanceCents: number;
}

export const PRESET_USERS: UserProfile[] = [
  {
    id: 'usr_aman_01',
    name: 'Aman (You)',
    email: 'aman@tapcash.io',
    avatar: '👨‍💻',
    devicePublicKey: 'ed25519_pub_aman_9901',
    balanceCents: 50000, // ₹500.00
  },
  {
    id: 'usr_sarah_02',
    name: 'Sarah Jenkins',
    email: 'sarah@tapcash.io',
    avatar: '👩‍💼',
    devicePublicKey: 'ed25519_pub_sarah_8821',
    balanceCents: 35000, // ₹350.00
  },
  {
    id: 'usr_merchant_coffee_99',
    name: 'Metro Coffee Roasters',
    email: 'merchant@metrocoffee.com',
    avatar: '☕',
    devicePublicKey: 'ed25519_pub_metro_coffee_7719',
    balanceCents: 120000, // ₹1,200.00
  },
];

class UserManager {
  private currentUser: UserProfile = PRESET_USERS[0];
  private userBalances: Record<string, number> = {
    usr_aman_01: 50000,
    usr_sarah_02: 35000,
    usr_merchant_coffee_99: 120000,
  };

  getCurrentUser(): UserProfile {
    return {
      ...this.currentUser,
      balanceCents: this.userBalances[this.currentUser.id] || 0,
    };
  }

  switchUser(userId: string): UserProfile {
    const found = PRESET_USERS.find((u) => u.id === userId);
    if (found) {
      this.currentUser = found;
    }
    return this.getCurrentUser();
  }

  getAllUsers(): UserProfile[] {
    return PRESET_USERS.map((u) => ({
      ...u,
      balanceCents: this.userBalances[u.id] || 0,
    }));
  }

  transfer(fromUserId: string, toEmailOrId: string, amountCents: number): { success: boolean; error?: string; toUser?: UserProfile } {
    if (this.userBalances[fromUserId] < amountCents) {
      return { success: false, error: 'Insufficient balance' };
    }

    const toUser = PRESET_USERS.find((u) => u.email.toLowerCase() === toEmailOrId.toLowerCase() || u.id === toEmailOrId);
    
    // Deduct sender
    this.userBalances[fromUserId] -= amountCents;

    // Credit recipient if in-system user
    if (toUser) {
      this.userBalances[toUser.id] = (this.userBalances[toUser.id] || 0) + amountCents;
    }

    return { success: true, toUser };
  }

  topUp(userId: string, amountCents: number) {
    this.userBalances[userId] = (this.userBalances[userId] || 0) + amountCents;
  }
}

export const UsersDB = new UserManager();
