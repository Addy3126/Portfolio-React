// Site copy.
export const site = {
  name: 'Aditya Sharma',
  tagline: 'Software & Web Developer',
  location: 'Delhi, India',
  timeZone: 'Asia/Kolkata',
  status: 'Available for work',
}

export const about = {
  heading: 'About',
  body:
    'A 21-year-old studying Data Science and Artificial Intelligence (Computer Science Engineering) at SRM University, Sonipat. Most of my spare time goes into web projects, and I like picking up anything that looks interesting and useful.',
  skills: ['HTML & CSS', 'JavaScript', 'React', 'Three.js', 'Node.js', 'Python', 'MongoDB', 'MySQL'],
}

// One project per lit tower (see `project` in src/scene/ruins/layout.js). The tower's front
// windows carry the project when you walk up to it (src/scene/Facade.jsx): the name, `pitch`
// and `status` along the top floor, then each line of `facts` in reading order, and the
// brightest window opens `link`. `slug` is the direct link (…/#slug). `embed`: the site may
// be shown inside this one (checked: it sends no header forbidding it); otherwise, and always
// on phones, the link opens in a new tab. `preview`: a scroll-through capture of the site for
// the broken-out opening in the wall (made by tools/capture-previews.mjs).
export const projects = [
  {
    slug: 'sourish',
    name: 'Sourish Industries',
    summary:
      'Business website for an automotive drivetrain parts manufacturer: product catalogue with detail views, slideshow, and a contact form that emails enquiries through a hardened Express API.',
    stack: ['React', 'TypeScript', 'Vite', 'Express', 'Nodemailer'],
    pitch: 'Website for a drivetrain parts maker',
    status: ['Client site', 'Live'],
    facts: [
      ['Front end', 'React · TypeScript · Vite'],
      ['Back end', 'Express · Nodemailer'],
    ],
    link: 'https://sourish-industries.vercel.app',
    linkLabel: 'Visit site',
    enterLabel: 'Enter site',
    embed: true,
    preview: 'previews/sourish.webp',
  },
  {
    slug: 'cancer-classification',
    name: 'Unified Cancer Classification',
    summary:
      'Deep-learning classifier for medical images across several cancer types, with Grad-CAM heatmaps that show what the model looked at, served through a Flask API and a React upload interface.',
    stack: ['TensorFlow', 'Keras', 'OpenCV', 'Flask', 'React', 'TypeScript'],
    pitch: 'Cancer image classifier with heatmaps',
    status: ['Demo', 'Live'],
    facts: [
      ['Model', 'TensorFlow · Keras · OpenCV'],
      ['App', 'Flask · React · TypeScript'],
    ],
    link: 'https://unified-cancer-classification.vercel.app',
    linkLabel: 'Try it',
    enterLabel: 'Try it',
    embed: true,
    preview: 'previews/cancer-classification.webp',
  },
  {
    slug: 'finance-tracker',
    name: 'Finance Tracker',
    summary:
      'Personal finance app to log income and expenses in your own categories, filter them by date and category, and see where the money goes in charts. JWT sign-in with hashed passwords, an Express API and a MongoDB backend.',
    stack: ['MongoDB', 'Express', 'React', 'Node.js', 'Redux Toolkit', 'Chart.js'],
    pitch: 'Track income and spending',
    status: ['Source', 'On GitHub'],
    facts: [
      ['Log', 'Income and expenses'],
      ['Sort', 'Your own categories'],
      ['Filter', 'By date and category'],
      ['See', 'Chart.js doughnut charts'],
      ['Sign-in', 'JWT · bcrypt'],
      ['Back end', 'Express · Mongoose'],
      ['Front end', 'React · Redux Toolkit'],
      ['Data', 'React Query · Formik'],
      ['Style', 'Tailwind CSS'],
      ['Account', 'Profile · password change'],
    ],
    link: 'https://github.com/Addy3126/Finance-Tracker-using-MERN',
    linkLabel: 'View code',
    enterLabel: 'View code',
    embed: false, // GitHub refuses to be shown inside other sites
    preview: 'previews/finance-tracker.webp', // its own source code: there is no live demo
  },
]

export const contact = {
  heading: 'Say hello',
  email: 'adi.sharma3126@gmail.com',
  phone: '+91 81788 59524',
  phoneHref: 'tel:+918178859524',
  links: [
    { label: 'GitHub', href: 'https://github.com/Addy3126' },
    { label: 'LinkedIn', href: 'https://www.linkedin.com/in/aditya-sharma-8a5476282/' },
  ],
}
