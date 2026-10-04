import React, {useState} from 'react';
import {StyleProp, StyleSheet, Text, TouchableOpacity, ViewStyle} from 'react-native';

type Props = {
  label: string;
  onPress: () => void;
  /** Layout unit (1u = 1/540 of screen height). */
  u: number;
  style?: StyleProp<ViewStyle>;
  primary?: boolean;
  hasTVPreferredFocus?: boolean;
};

/** Button with a clear D-pad focus state (outline + lift), since TV users navigate by focus. */
export const FocusButton = ({label, onPress, u, style, primary, hasTVPreferredFocus}: Props) => {
  const [focused, setFocused] = useState(false);
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      hasTVPreferredFocus={hasTVPreferredFocus}
      style={[
        {
          paddingVertical: 8 * u,
          paddingHorizontal: 12 * u,
          borderRadius: 6 * u,
          borderWidth: 2 * u,
          alignItems: 'center',
          backgroundColor: primary ? '#2563eb' : '#2d3748',
          borderColor: 'transparent',
        },
        focused && {borderColor: '#ffffff', backgroundColor: primary ? '#3b82f6' : '#4a5568', transform: [{scale: 1.05}]},
        style,
      ]}>
      <Text style={[styles.text, {fontSize: 15 * u}]}>{label}</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  text: {color: '#fff', fontWeight: '600'},
});
