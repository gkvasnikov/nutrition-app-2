import styles from './ButtonSeeAll.module.css'

export default function ButtonSeeAll({ onClick }) {
  return (
    <button className={styles.btn} onClick={onClick}>
      See all
    </button>
  )
}
