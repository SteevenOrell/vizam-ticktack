import { useRouter } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { useDatabase } from '../../data/DatabaseProvider';
import { ensureDefaultCategories } from '../../data/profile';
import { LOCAL_OWNER } from '../../domain/models';
import { usePreferences } from '../../state/preferences';
import { useSession } from '../../state/session';
import { Button } from '../../ui/Button';
import { innerColumnStyle } from '../../ui/Centered';
import { DeckPanel } from '../../ui/Card';
import { GradientHeader } from '../../ui/GradientHeader';
import { decorativeProps } from '../../ui/platform';
import { Text } from '../../ui/Text';
import { space } from '../../ui/theme/layout';
import { useTheme } from '../../ui/theme/ThemeProvider';
import { Wordmark } from '../../ui/brand/Wordmark';

const STEPS = [
  { numeral: '06:30', title: 'onboarding.step1Title', body: 'onboarding.step1Body', arc: 0.25 },
  { numeral: 'onboarding.step2Numeral', title: 'onboarding.step2Title', body: 'onboarding.step2Body', arc: 0.6 },
  { numeral: '92%', title: 'onboarding.step3Title', body: 'onboarding.step3Body', arc: 0.92 },
] as const;

/** Abstract arc drawn in the palette (DESIGN.md section 9: no photos). */
function Arc({ value, color, track }: { value: number; color: string; track: string }) {
  const r = 44;
  const c = 2 * Math.PI * r;
  return (
    <Svg width={112} height={112} viewBox="0 0 112 112" {...decorativeProps}>
      <Circle cx={56} cy={56} r={r} stroke={track} strokeWidth={10} fill="none" />
      <Circle
        cx={56}
        cy={56}
        r={r}
        stroke={color}
        strokeWidth={10}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={`${c * value} ${c}`}
        transform="rotate(-90 56 56)"
      />
      <Path d="M56 30v26l14 8" stroke={color} strokeWidth={6} strokeLinecap="round" fill="none" />
    </Svg>
  );
}

/**
 * Onboarding (DESIGN.md section 7.1): three cards with a big numeral and one sentence, then the choice to continue
 * as a guest, create an account or sign in. "VIZAM portfolio concept" note at the bottom.
 */
export function OnboardingScreen() {
  const { t, i18n } = useTranslation();
  const { colors, header } = useTheme();
  const router = useRouter();
  const database = useDatabase();
  const setOnboardingDone = usePreferences((s) => s.setOnboardingDone);
  const signedIn = useSession((s) => s.status === 'signedIn');
  const [step, setStep] = useState(0);
  const final = step >= STEPS.length;
  const card = STEPS[Math.min(step, STEPS.length - 1)]!;

  const finish = async (next: '/' | '/sign-up' | '/sign-in') => {
    if (database.status === 'ready' && !signedIn) {
      await ensureDefaultCategories({ db: database.db, ownerId: LOCAL_OWNER, newId: randomUUID }, i18n.language).catch(
        () => undefined,
      );
    }
    setOnboardingDone(true);
    if (next === '/') router.replace('/');
    else router.replace(next);
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]} testID="screen-onboarding">
      <ScrollView contentContainerStyle={styles.scroll} bounces={false}>
        <GradientHeader>
          <View style={styles.brand}>
            <Wordmark width={132} color={header.on.text} />
          </View>
          <View style={styles.hero}>
            <View style={styles.flex}>
              <Text variant="dayFace" color={header.on.text} style={styles.numeral} accessibilityElementsHidden>
                {final ? '3/3' : card.numeral.startsWith('onboarding.') ? t(card.numeral as never) : card.numeral}
              </Text>
            </View>
            <Arc value={final ? 1 : card.arc} color={header.on.fill} track={header.on.trackBg} />
          </View>
        </GradientHeader>
        <DeckPanel style={styles.panel}>
          {final ? (
            <View style={styles.block}>
              <Text variant="title1" accessibilityRole="header">
                {t('onboarding.readyTitle')}
              </Text>
              <Text variant="body" color={colors.textSecondary}>
                {t('onboarding.readyBody')}
              </Text>
              <View style={styles.actions}>
                <Button
                  label={t('onboarding.guest')}
                  onPress={() => void finish('/')}
                  fullWidth
                  testID="onboarding-guest"
                />
                <Button
                  label={t('onboarding.createAccount')}
                  variant="secondary"
                  onPress={() => void finish('/sign-up')}
                  fullWidth
                  testID="onboarding-signup"
                />
                <Button
                  label={t('onboarding.signIn')}
                  variant="ghost"
                  onPress={() => void finish('/sign-in')}
                  fullWidth
                  testID="onboarding-signin"
                />
              </View>
              <Text variant="caption" color={colors.textSecondary}>
                {t('onboarding.guestNote')}
              </Text>
            </View>
          ) : (
            <View style={styles.block}>
              <Text variant="caption" color={colors.textSecondary}>
                {t('onboarding.stepOf', { step: step + 1, total: STEPS.length })}
              </Text>
              <Text variant="title1" accessibilityRole="header">
                {t(card.title)}
              </Text>
              <Text variant="body" color={colors.textSecondary}>
                {t(card.body)}
              </Text>
              <View style={styles.dots} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                {STEPS.map((_, i) => (
                  <View
                    key={i}
                    style={[
                      styles.dot,
                      { backgroundColor: i === step ? colors.accent : colors.chip, width: i === step ? 22 : 8 },
                    ]}
                  />
                ))}
              </View>
              <View style={styles.actions}>
                <Button
                  label={t('onboarding.next')}
                  onPress={() => setStep((s) => s + 1)}
                  fullWidth
                  testID="onboarding-next"
                />
                <Button label={t('onboarding.skip')} variant="ghost" onPress={() => setStep(STEPS.length)} fullWidth />
              </View>
            </View>
          )}
          <Text variant="caption" color={colors.textTertiary} align="center" style={styles.concept}>
            {t('app.concept')}
          </Text>
        </DeckPanel>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  scroll: { flexGrow: 1 },
  brand: { ...innerColumnStyle, alignItems: 'flex-start' },
  hero: { ...innerColumnStyle, flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.xl },
  numeral: { fontVariant: ['tabular-nums'] },
  panel: { paddingBottom: space.xxl },
  block: { ...innerColumnStyle, gap: space.sm },
  dots: { flexDirection: 'row', gap: 6, marginVertical: space.sm },
  dot: { height: 8, borderRadius: 4 },
  actions: { gap: space.xs, marginTop: space.sm },
  concept: { marginTop: space.xl },
});
