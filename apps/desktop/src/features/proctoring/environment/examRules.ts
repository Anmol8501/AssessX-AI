/** Exam rules: the text candidates read before the exam, and the instruction for each AI observation. */

/** The rules, shown before the exam starts (and kept short enough to read). */
export const EXAM_RULES: { title: string; detail: string }[] = [
  {
    title: 'Stay in the exam window',
    detail:
      'Do not switch tabs or apps, swipe with three or four fingers, press the Windows key, or click outside the exam — AssessX returns to the exam straight away and every switch counts. You get 2 warnings; the 3rd time locks your exam until the administrator releases it. AssessX cannot be closed until you submit.',
  },
  {
    title: 'Keep your head and chest in view',
    detail: 'Sit so the camera sees your whole head and your upper body down to your chest, the whole time. A face that is cut off or too close is flagged.',
  },
  { title: 'Only you', detail: 'No one else may be in view of the camera or help you during the exam.' },
  { title: 'Face the screen', detail: 'Do not turn your head away or look around the room.' },
  {
    title: 'No phones or other devices',
    detail: 'Keep mobile phones, other laptops or tablets, books and calculators out of view. The camera checks for them, and you will be warned if one is seen.',
  },
  {
    title: 'No shortcuts or copying',
    detail: 'Copy, paste, screenshots, printing, right-click and keyboard shortcuts (Ctrl, Alt, the Windows key) are disabled.',
  },
  {
    title: 'Stay in fullscreen',
    detail:
      'The exam runs in fullscreen. The exam supervisor sees these events and may watch your camera live, and can lock your exam at any time.',
  },
]

const AI_MESSAGE: Record<string, string> = {
  FACE_NOT_DETECTED: 'We can’t see your face. Look at the screen and keep your face in view of the camera.',
  MULTIPLE_FACES_DETECTED: 'More than one person is visible. Only you may be in view during the exam.',
  HEAD_ORIENTATION_CHANGED: 'Please face the screen. Don’t turn your head away during the exam.',
  GAZE_AWAY: 'Please keep your eyes on the screen.',
  CAMERA_TOO_DARK: 'Your camera image is too dark. Turn on a light so your face is visible.',
  FACE_TOO_FAR: 'Please move a little closer to the camera.',
  FACE_TOO_CLOSE: 'Please move a little further from the camera.',
  UPPER_BODY_NOT_VISIBLE: 'Sit so your whole head and your upper body, down to your chest, are visible to the camera. Move back or tilt the camera down.',
  PHONE_DETECTED: 'A mobile phone is visible. Put it away — phones are not allowed during the exam.',
  BOOK_DETECTED: 'A book or notebook is visible. Put it away unless your exam allows it.',
  LAPTOP_DETECTED: 'Another laptop or tablet is visible. Close it and put it away.',
  HANDHELD_DEVICE_DETECTED: 'A handheld device (a calculator or remote) is visible. Put it away unless your exam allows it.',
}

export function aiWarningMessage(condition: string): string | null {
  return AI_MESSAGE[condition] ?? null
}
