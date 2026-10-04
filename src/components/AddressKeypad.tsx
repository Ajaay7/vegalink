import React, {useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {FocusButton} from './FocusButton';

type Props = {
  initial: string;
  /** Layout unit (1u = 1/540 of screen height) so sizes scale with the TV's layout viewport. */
  u: number;
  onDone: (value: string) => void;
  onCancel: () => void;
};

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', ':'];

/**
 * D-pad friendly host:port editor. The system on-screen keyboard (IME) isn't
 * available to this app on Vega, so TextInput can't be used.
 */
export const AddressKeypad = ({initial, u, onDone, onCancel}: Props) => {
  const [value, setValue] = useState(initial);
  const s = styles(u);

  return (
    <View style={s.root}>
      <Text style={s.label}>PC address (IP:port)</Text>
      <View style={s.display}>
        <Text style={s.displayText}>{value || ' '}</Text>
      </View>
      <View style={s.grid}>
        {KEYS.map((k, i) => (
          <FocusButton key={k} u={u} label={k} style={s.key} onPress={() => setValue((v) => v + k)} hasTVPreferredFocus={i === 0} />
        ))}
      </View>
      <View style={s.row}>
        <FocusButton u={u} label="⌫ Delete" style={s.wide} onPress={() => setValue((v) => v.slice(0, -1))} />
        <FocusButton u={u} label="Clear" style={s.wide} onPress={() => setValue('')} />
      </View>
      <View style={s.row}>
        <FocusButton u={u} label="Cancel" style={s.wide} onPress={onCancel} />
        <FocusButton u={u} label="Done" style={s.wide} primary onPress={() => onDone(value.trim())} />
      </View>
    </View>
  );
};

const styles = (u: number) =>
  StyleSheet.create({
    root: {width: 300 * u},
    label: {color: '#9aa4b2', fontSize: 12 * u, marginBottom: 4 * u},
    display: {borderWidth: 1, borderColor: '#4a5568', borderRadius: 6 * u, paddingHorizontal: 10 * u, paddingVertical: 6 * u, marginBottom: 8 * u},
    displayText: {color: '#fff', fontSize: 18 * u},
    grid: {flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between'},
    row: {flexDirection: 'row', justifyContent: 'space-between'},
    key: {width: 94 * u, marginBottom: 6 * u},
    wide: {width: 145 * u, marginBottom: 6 * u},
  });
