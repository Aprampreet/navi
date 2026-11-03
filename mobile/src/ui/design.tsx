import React from 'react';
import {Pressable, ScrollView, Text, View, type ViewStyle} from 'react-native';

export type ScreenName = 'home' | 'assistance' | 'navigation' | 'settings';
export type Appearance = 'dark' | 'light';
export type Theme = {
  background: string; surface: string; surfaceRaised: string; text: string;
  secondary: string; accent: string; accentInk: string; accentText: string; border: string;
  positive: string; warning: string; danger: string; scale: number; appearance: Appearance;
};

export function createTheme(highContrast: boolean, largeText: boolean,
  appearance: Appearance = 'dark'): Theme {
  const shared = {scale: largeText ? 1.18 : 1, appearance};
  return highContrast ? {
    ...shared, background: '#000000', surface: '#101010', surfaceRaised: '#1B1B1B',
    text: '#FFFFFF', secondary: '#E4E4E4', accent: '#FFD84A', accentInk: '#FFD84A', accentText: '#111111',
    border: '#FFFFFF', positive: '#A9F7C4', warning: '#FFE19A', danger: '#FFBEB8',
  } : appearance === 'light' ? {
    ...shared, background: '#FAF9F4', surface: '#FFFFFF', surfaceRaised: '#F0F1EB',
    text: '#111827', secondary: '#344054', accent: '#FFE34F', accentInk: '#775100',
    accentText: '#111827', border: '#52616B', positive: '#126B3F',
    warning: '#865000', danger: '#A52626',
  } : {
    ...shared, background: '#10191D', surface: '#1A272C', surfaceRaised: '#233239',
    text: '#F8F5ED', secondary: '#C8D3D2', accent: '#F4C967', accentInk: '#F4C967',
    accentText: '#172024',
    border: '#72878B', positive: '#A6E8BB', warning: '#F9D78B', danger: '#FFB8AD',
  };
}

export function ActionButton({label, onPress, theme, hint, disabled = false, primary = false,
  danger = false, selected = false}: {
  label: string; onPress: () => void; theme: Theme; hint?: string; disabled?: boolean;
  primary?: boolean; danger?: boolean; selected?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label}
    accessibilityHint={hint || `Activate ${label}`}
    accessibilityState={{disabled, selected}} disabled={disabled} onPress={onPress}
    style={({pressed}) => ({minHeight: 60, borderRadius: 18, borderWidth: 2,
      borderColor: danger ? theme.danger : primary ?
        (theme.appearance === 'light' ? theme.text : theme.accent) : theme.border,
      backgroundColor: primary ? theme.accent : theme.surface,
      paddingHorizontal: 18, paddingVertical: 14, justifyContent: 'center',
      opacity: disabled ? 0.45 : pressed ? 0.78 : 1})}>
    <Text style={{color: danger ? theme.danger : primary ? theme.accentText : theme.text,
      fontSize: 18 * theme.scale, lineHeight: 25 * theme.scale, fontWeight: '800', textAlign: 'center'}}>
      {label}
    </Text>
  </Pressable>;
}

export function ScreenFrame({title, description, theme, children, style}: {
  title: string; description?: string; theme: Theme; children: React.ReactNode; style?: ViewStyle;
}) {
  return <ScrollView style={[{flex: 1, backgroundColor: theme.background}, style]}
    contentContainerStyle={{paddingHorizontal: 20, paddingTop: 24, paddingBottom: 36, gap: 18}}
    keyboardShouldPersistTaps="handled" removeClippedSubviews={false}>
    <View>
      <Text accessibilityRole="header" style={{color: theme.text, fontSize: 31 * theme.scale,
        lineHeight: 38 * theme.scale, fontWeight: '900', letterSpacing: -0.7}}>{title}</Text>
      {!!description && <Text style={{color: theme.secondary, fontSize: 15 * theme.scale,
        lineHeight: 23 * theme.scale, marginTop: 8}}>{description}</Text>}
    </View>
    {children}
  </ScrollView>;
}

export function StatusRow({label, value, theme, tone = 'normal'}: {
  label: string; value: string; theme: Theme; tone?: 'normal' | 'positive' | 'warning' | 'danger';
}) {
  const color = tone === 'positive' ? theme.positive : tone === 'warning' ? theme.warning :
    tone === 'danger' ? theme.danger : theme.text;
  return <View accessible accessibilityLabel={`${label}: ${value}`}
    style={{minHeight: 56, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: theme.border,
      flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap'}}>
    <Text style={{color: theme.secondary, fontSize: 14 * theme.scale, flexGrow: 1}}>{label}</Text>
    <Text style={{color, fontSize: 14 * theme.scale, fontWeight: '800'}}>{value}</Text>
  </View>;
}

export function Section({title, theme, children}: {title: string; theme: Theme; children: React.ReactNode}) {
  return <View style={{gap: 12}}>
    <Text accessibilityRole="header" style={{color: theme.accentInk, fontSize: 15 * theme.scale,
      fontWeight: '800', letterSpacing: 0.3}}>{title}</Text>
    {children}
  </View>;
}

const tabs: Array<{id: ScreenName; label: string; symbol: string}> = [
  {id: 'home', label: 'Home', symbol: '●'},
  {id: 'assistance', label: 'Assistance', symbol: '◎'},
  {id: 'navigation', label: 'Navigate', symbol: '↗'},
  {id: 'settings', label: 'Settings', symbol: '◌'},
];

export function BottomTabs({active, onChange, theme}: {
  active: ScreenName; onChange: (screen: ScreenName) => void; theme: Theme;
}) {
  return <View accessibilityRole="tablist" style={{flexDirection: 'row', backgroundColor: theme.surface,
    borderTopWidth: 1, borderTopColor: theme.border, paddingHorizontal: 4, paddingTop: 4}}>
    {tabs.map(tab => <Pressable key={tab.id} accessibilityRole="tab"
      accessibilityLabel={tab.label} accessibilityHint={`Open ${tab.label} screen`}
      accessibilityState={{selected: active === tab.id}} onPress={() => onChange(tab.id)}
      style={({pressed}) => ({flex: 1, minHeight: 62, alignItems: 'center', justifyContent: 'center',
        paddingHorizontal: 2, paddingVertical: 6, borderRadius: 10,
        backgroundColor: active === tab.id ? theme.surfaceRaised : theme.surface,
        opacity: pressed ? 0.72 : 1})}>
      <Text accessible={false} style={{fontSize: 20, color: active === tab.id ? theme.accentInk : theme.secondary}}>
        {tab.symbol}
      </Text>
      <Text style={{fontSize: 11 * theme.scale, lineHeight: 16 * theme.scale, fontWeight: '800',
        color: active === tab.id ? theme.accentInk : theme.secondary, textAlign: 'center'}}>{tab.label}</Text>
    </Pressable>)}
  </View>;
}
